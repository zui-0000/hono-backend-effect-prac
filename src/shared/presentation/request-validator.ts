import { Effect, ParseResult, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";
import type { Context } from "hono";

import type {
  AccessTokenClaims,
  AccessTokenIssuer,
} from "~/shared/domain/access-token-issuer";
import { BadRequestError } from "~/shared/errors/bad-request-error";
import type { ErrorDetail } from "~/shared/errors/error-detail";

import { ErrorMessage } from "./constants/error-message";
import { HttpHeader } from "./constants/http-header";
import type { ApplicationError } from "./handle-error-response";
import { verifyBearer } from "./verify-bearer";

/**
 * リクエストの検証ユーティリティ。
 *
 * 「入力源ごとの検証」と「ユースケース入力の組み立て」を分けている。
 * **呼ぶ側が違う**ので、そこを取り違えないこと。
 *
 * 入力源ごとの検証 — 呼ぶのは validateRequest だけ (controller からは呼ばない):
 *   - validateJson   … ボディ             `c.req.json()`
 *   - validateHeader … ヘッダ             `c.req.header()`
 *   - validateParams … パスパラメータ     `c.req.param()`   例: /users/:id の :id
 *   - validateQuery  … クエリパラメータ   `c.req.query()`   例: /users?page=2
 *
 * どれを検証するかは routes の `request` 宣言 (`RequestSchemas`) が決め、
 * validateRequest が実行して controller に渡す形に組み立てる。
 * controller が受け取るのは検証済みの値なので、ここで再度呼ぶと
 * 同じ検証を二度走らせることになる。
 *
 * ユースケース入力の組み立て — 呼ぶのは controller:
 *   - decodeInput    … 検証済みの値を合成し、値オブジェクトへ変換する
 *
 * decodeInput は変換に見えるが、戻り値が Effect<A, BadRequestError> であるとおり
 * 「組み立てた値がコマンド入力スキーマを満たすか」を検証している (満たさなければ 400)。
 *
 * 名前の注意: パスパラメータとクエリパラメータはどちらも「パラメータ」だが、
 * validateParams が扱うのは **パス** のほう。Hono 自身が `c.req.param()` /
 * `c.req.query()` と呼び分けており、生成スキーマも `GetUserParams` (パス) なので
 * それに揃えている。
 *
 * パスパラメータとボディを併用する、認証情報を混ぜる、ボディの一部だけ使う、
 * といった組み合わせにも対応できるよう、あえて 1 つの関数にまとめていない。
 *
 * いずれも errors: "all" で最初の違反では止めず、全フィールドの違反を集めたうえで、
 * ここで BadRequestError に変換する (Effect Schema の ParseError を層の外へ漏らさない)。
 */

const decodeOptions = { errors: "all" } as const;

/**
 * 検証エラーを「どのフィールドが、なぜ不正か」の一覧へ変換する。
 * ArrayFormatter は違反箇所の path とメッセージを構造化して返すため、
 * ネストしたフィールドは "meta.respondedAt" のようにドット区切りで表現する。
 * path が空 (ボディ全体が不正など) の場合は "-" とする。
 */
const toErrorDetails = (error: ParseError): readonly ErrorDetail[] =>
  ParseResult.ArrayFormatter.formatErrorSync(error).map((issue) => ({
    field: issue.path.length === 0 ? "-" : issue.path.join("."),
    message: issue.message,
  }));

/** スキーマで検証し、失敗を BadRequestError (違反フィールド付き) に変換する。 */
const decode = <A, I>(
  schema: Schema.Schema<A, I>,
  source: unknown,
): Effect.Effect<A, BadRequestError> =>
  Schema.decodeUnknown(
    schema,
    decodeOptions,
  )(source).pipe(
    Effect.mapError(
      (error) =>
        new BadRequestError({
          message: ErrorMessage.BadRequest,
          details: toErrorDetails(error),
        }),
    ),
  );

/** リクエストボディを JSON として取得し、API 契約スキーマで検証する。 */
export const validateJson = <A, I>(
  c: Context,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, BadRequestError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => c.req.json(),
      catch: () =>
        new BadRequestError({
          message: ErrorMessage.MalformedJson,
        }),
    });
    return yield* decode(schema, raw);
  });

/**
 * リクエストヘッダを API 契約スキーマで検証する (X-Request-Id など)。
 *
 * HTTP のヘッダ名は大文字小文字を区別しない。Hono は小文字に正規化して返すため、
 * 契約 (OpenAPI が定義するヘッダ名) が期待するキーへ揃えてから検証する。
 * headerNames には契約上のヘッダ名 (例: "X-Request-Id") を渡す。
 */
export const validateHeader = <A, I>(
  c: Context,
  schema: Schema.Schema<A, I>,
  headerNames: readonly string[],
): Effect.Effect<A, BadRequestError> => {
  const received = c.req.header();
  const source = Object.fromEntries(
    headerNames.map((name) => [name, received[name.toLowerCase()]]),
  );
  return decode(schema, source);
};

/** パスパラメータを API 契約スキーマで検証する。 */
export const validateParams = <A, I>(
  c: Context,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, BadRequestError> => decode(schema, c.req.param());

/**
 * クエリパラメータを API 契約スキーマで検証する。
 *
 * `c.req.query()` は繰り返し指定 (`?tag=a&tag=b`) のうち **最初の 1 つだけ** を返す。
 * 配列で受けたい契約を作る場合は `c.req.queries()` に切り替える必要がある
 * (現時点の契約に繰り返しパラメータは無いため query() で足りている)。
 */
export const validateQuery = <A, I>(
  c: Context,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, BadRequestError> => decode(schema, c.req.query());

/**
 * 検証済みの値を合成してユースケースの入力へ変換する (値オブジェクト化・正規化)。
 * 入力源が複数ある場合は呼び出し側で組み立てた 1 つのオブジェクトを渡す。
 */
export const decodeInput = <A, I>(
  schema: Schema.Schema<A, I>,
  source: unknown,
): Effect.Effect<A, BadRequestError> => decode(schema, source);

/**
 * リクエストのどの入力源を契約で検証するかの宣言。
 *
 * header は必須。全エンドポイントが相関 ID (X-Request-Id) を要求するため。
 * それ以外はエンドポイントごとに要否が変わるので任意。
 * 指定したものだけが controller に渡る (指定しなかった入力源は型に現れない)。
 */
export type RequestSchemas = {
  readonly header: Schema.Schema.AnyNoContext;
  readonly body?: Schema.Schema.AnyNoContext;
  readonly params?: Schema.Schema.AnyNoContext;
  readonly query?: Schema.Schema.AnyNoContext;
  /**
   * 認証を要求するか。契約の `@useAuth(BearerAuth)` と対になる。
   *
   * 他の入力源と違ってスキーマではなく true を書くのは、検証の相手が
   * リクエストの一部ではなく**署名そのもの**だから。宣言すると
   * controller の入力に検証済みの claims (`auth`) が載る。
   */
  readonly auth?: true;
};

/**
 * 宣言した入力源に対応する、検証済みの値の形。
 * `{ header, body }` を宣言すれば `{ header, body }` が導かれる。
 * 宣言していない入力源は型に現れないので、controller で誤って使うと
 * コンパイルエラーになる。
 */
type ValidatedRequest<Req extends RequestSchemas> = {
  readonly [K in keyof Req as Req[K] extends Schema.Schema.AnyNoContext
    ? K
    : never]: Req[K] extends Schema.Schema<infer A, infer _I, never>
    ? A
    : never;
} & (true extends Req["auth"]
  ? { readonly auth: AccessTokenClaims }
  : Record<never, never>);

/** controller が受け取る引数。検証済みの入力に加え、生の Context も渡す。 */
export type ControllerInput<Req extends RequestSchemas> =
  ValidatedRequest<Req> & {
    readonly c: Context;
  };

/**
 * 宣言された入力源を検証し、controller に渡す形に組み立てる。
 *
 * ヘッダを最初に見るのは、相関 ID が全リクエスト必須だから (まずそこで弾く)。
 * **認証は最後**に見る。契約違反 (400) のほうが先に分かるほうが直しやすく、
 * かつ「認証を通さないと入力の不備が分からない」状態を避けられる
 * (この順序を変えるなら、認証を Hono の middleware へ降ろす話になる。
 * 判断は docs/04-backlog.md に置いてある)。
 */
export const validateRequest = <Req extends RequestSchemas>(
  c: Context,
  request: Req,
): Effect.Effect<ControllerInput<Req>, ApplicationError, AccessTokenIssuer> =>
  Effect.gen(function* () {
    const validated: Record<string, unknown> = { c };

    validated["header"] = yield* validateHeader(c, request.header, [
      HttpHeader.RequestId,
    ]);
    if (request.body !== undefined) {
      validated["body"] = yield* validateJson(c, request.body);
    }
    if (request.params !== undefined) {
      validated["params"] = yield* validateParams(c, request.params);
    }
    if (request.query !== undefined) {
      validated["query"] = yield* validateQuery(c, request.query);
    }
    if (request.auth === true) {
      validated["auth"] = yield* verifyBearer(c);
    }

    return validated as ControllerInput<Req>;
  });
