import { Effect, type Schema } from "effect";
import type { Context } from "hono";

import { BadRequestError } from "~/shared/errors/bad-request-error";

import { ErrorMessage } from "../constants/error-message";
import { HttpHeader } from "../constants/http-header";
import { decodeInput } from "../decode-input";
import type { AuthenticatedInput } from "./verify-bearer";

/**
 * 経路の宣言（`RequestSchemas`）に従って、HTTP の各入力源を契約で検証する。
 *
 * 入力源ごとの取り出し方だけが違い、検証そのものは
 * [`decode-input.ts`](../decode-input.ts) の `decodeInput` に委ねる。
 *
 *   validateJson   … ボディ           `c.req.json()`
 *   validateHeader … ヘッダ           `c.req.header()`
 *   validateParams … パスパラメータ   `c.req.param()`   例: /users/:id の :id
 *   validateQuery  … クエリパラメータ `c.req.query()`   例: /users?page=2
 *
 * いずれも外へは出さない。**controller から呼ぶのは `decodeInput` だけ**で、
 * こちらを呼ぶと同じ検証を二度走らせることになる。
 *
 * 名前の注意: パスパラメータとクエリパラメータはどちらも「パラメータ」だが、
 * validateParams が扱うのは **パス** のほう。Hono 自身が `c.req.param()` /
 * `c.req.query()` と呼び分けており、生成スキーマも `GetUserParams` (パス) なので
 * それに揃えている。
 *
 * 認証は扱わない（`verify-bearer.ts` の担当。実行も**こちらより先**）。
 */

/** リクエストボディを JSON として取得し、API 契約スキーマで検証する。 */
const validateJson = <A, I>(
  c: Context,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, BadRequestError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => c.req.json(),
      catch: () => new BadRequestError({ message: ErrorMessage.MalformedJson }),
    });
    return yield* decodeInput(schema)(raw);
  });

/**
 * リクエストヘッダを API 契約スキーマで検証する (X-Request-Id など)。
 *
 * HTTP のヘッダ名は大文字小文字を区別しない。Hono は小文字に正規化して返すため、
 * 契約 (OpenAPI が定義するヘッダ名) が期待するキーへ揃えてから検証する。
 */
const validateHeader = <A, I>(
  c: Context,
  schema: Schema.Schema<A, I>,
  headerNames: readonly string[],
): Effect.Effect<A, BadRequestError> => {
  const received = c.req.header();
  const source = Object.fromEntries(
    headerNames.map((name) => [name, received[name.toLowerCase()]]),
  );
  return decodeInput(schema)(source);
};

/** パスパラメータを API 契約スキーマで検証する。 */
const validateParams = <A, I>(
  c: Context,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, BadRequestError> => decodeInput(schema)(c.req.param());

/**
 * クエリパラメータを API 契約スキーマで検証する。
 *
 * `c.req.query()` は繰り返し指定 (`?tag=a&tag=b`) のうち **最初の 1 つだけ** を返す。
 * 配列で受けたい契約を作る場合は `c.req.queries()` に切り替える必要がある
 * (現時点の契約に繰り返しパラメータは無いため query() で足りている)。
 */
const validateQuery = <A, I>(
  c: Context,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, BadRequestError> => decodeInput(schema)(c.req.query());

/**
 * リクエストのどの入力源を契約で検証するかの宣言。**値はすべてスキーマ。**
 *
 * header は必須。全エンドポイントが相関 ID (X-Request-Id) を要求するため。
 * それ以外はエンドポイントごとに要否が変わるので任意。
 * 指定したものだけが controller に渡る (指定しなかった入力源は型に現れない)。
 *
 * 認証の要否 (`auth`) はここに入れない。検証の相手がリクエストの一部ではなく
 * **署名そのもの**で、スキーマを持たないため。`handleWithEffect` の
 * トップレベルに置いてある。
 */
export type RequestSchemas = {
  readonly header: Schema.Schema.AnyNoContext;
  readonly body?: Schema.Schema.AnyNoContext;
  readonly params?: Schema.Schema.AnyNoContext;
  readonly query?: Schema.Schema.AnyNoContext;
};

/**
 * 宣言した入力源に対応する、検証済みの値の形。
 * `{ header, body }` を宣言すれば `{ header, body }` が導かれる。
 * 宣言していない入力源は型に現れないので、controller で誤って使うと
 * コンパイルエラーになる。
 */
export type ValidatedRequest<Req extends RequestSchemas> = {
  readonly [
    K in keyof Req as Req[K] extends Schema.Schema.AnyNoContext ? K : never
  ]: Req[K] extends Schema.Schema<infer A, infer _I, never> ? A : never;
};

/**
 * controller が受け取る引数。
 * 検証済みの入力 + 認証済みの claims (要る経路だけ) + 生の Context。
 */
export type ControllerInput<
  Req extends RequestSchemas,
  Auth extends true | undefined,
> = ValidatedRequest<Req> &
  AuthenticatedInput<Auth> & {
    readonly c: Context;
  };

/**
 * 宣言された入力源を API 契約で検証する。**認証は扱わない** (verifyAuth の担当)。
 *
 * ヘッダから見るのは、相関 ID が全リクエスト必須だから (まずそこで弾く)。
 */
export const validateRequest = <Req extends RequestSchemas>(
  c: Context,
  request: Req,
): Effect.Effect<ValidatedRequest<Req>, BadRequestError> =>
  Effect.gen(function* () {
    const validated: Record<string, unknown> = {};

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

    return validated as ValidatedRequest<Req>;
  });
