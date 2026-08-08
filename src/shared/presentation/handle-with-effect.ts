import { Effect, type ManagedRuntime, Schema } from "effect";
import type { Context, Handler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type {
  AccessTokenClaims,
  AccessTokenIssuer,
} from "~/shared/domain/access-token-issuer";
import type { UuidGenerator } from "~/shared/domain/uuid-generator";

import { HttpHeader } from "./constants/http-header";
import { HttpStatus } from "./constants/http-status";
import {
  type ApplicationError,
  defectResponse,
  handleErrorResponse,
} from "./handle-error-response";
import { logDefect, logFailure, resolveRequestId } from "./request-log";
import {
  validateHeader,
  validateJson,
  validateParams,
  validateQuery,
} from "./request-validator";
import { verifyBearer } from "./verify-bearer";

/**
 * リクエストのどの入力源を契約で検証するかの宣言。
 *
 * header は必須。全エンドポイントが相関 ID (X-Request-Id) を要求するため。
 * それ以外はエンドポイントごとに要否が変わるので任意。
 * 指定したものだけが controller に渡る (指定しなかった入力源は型に現れない)。
 */
type RequestSchemas = {
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
type ControllerInput<Req extends RequestSchemas> = ValidatedRequest<Req> & {
  readonly c: Context;
};

/**
 * 本文を返さない応答 (204 No Content)。
 *
 * 更新・削除系のコマンドは状態を変えるだけで値を返さない (CQRS)。
 * 契約上も 204 なので本文がなく、生成スキーマも存在しない
 * (orval は本文のない応答にはスキーマを作らない)。よって body を取らない。
 */
type NoContentResponse = {
  readonly status: typeof HttpStatus.NoContent;
};

/** 本文を返す応答 (200 / 201 など)。 */
type ContentfulResponse<ResponseA, ResponseI> = {
  readonly status: ContentfulStatusCode;
  /** 応答ボディの契約スキーマ。request.body と同じく「HTTP のどの部分か」で命名する。 */
  readonly body: Schema.Schema<ResponseA, ResponseI>;
};

type NoContentSpec<Req extends RequestSchemas, R> = {
  readonly request: Req;
  readonly response: NoContentResponse;
  readonly controller: (
    input: ControllerInput<Req>,
  ) => Effect.Effect<void, ApplicationError, R>;
};

type ContentfulSpec<A, ResponseA, ResponseI, Req extends RequestSchemas, R> = {
  readonly request: Req;
  readonly response: ContentfulResponse<ResponseA, ResponseI>;
  readonly controller: (
    input: ControllerInput<Req>,
  ) => Effect.Effect<A, ApplicationError, R>;
};

/**
 * 宣言された入力源を検証し、controller に渡す形に組み立てる。
 * ヘッダを最初に見るのは、相関 ID が全リクエスト必須だから (まずそこで弾く)。
 */
const validateRequest = <Req extends RequestSchemas>(
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
    // 認証は最後に見る。契約違反 (400) のほうが先に分かるほうが直しやすく、
    // かつ「認証を通さないと入力の不備が分からない」状態を避けられる。
    if (request.auth === true) {
      validated["auth"] = yield* verifyBearer(c);
    }

    return validated as ControllerInput<Req>;
  });

/**
 * 共通の実行部。成功時の応答の作り方 (respond) だけを呼び出し側から受け取る。
 *
 * 実行の流れ:
 *   1. 相関 ID を解決し、応答ヘッダに載せる
 *   2. リクエストを API 契約で検証する (ヘッダ → ボディ → パス → クエリ → 認証)
 *   3. controller を実行する
 *   4. 結果を HTTP 応答に変換する (respond)
 *
 * 失敗時は handleErrorResponse が型付きエラーを HTTP 応答へ翻訳し、
 * 内部で何が起きたかは logFailure がサーバーログに残す
 * (外部には定型メッセージのみ返し、原因は露出させない)。
 * 相関 ID は応答ヘッダとログの双方に載せ、フロントエンドのログと突き合わせられる。
 *
 * defect (orDie / die で落とした失敗) は E チャネルに現れないため catchAll では
 * 拾えない。放っておくと runPromise が reject して Hono 既定の平文 500 が返り、
 * 契約と違う形の応答になったうえログも残らないので、ここで最後に受け止める。
 * **この受け皿は 1 箇所で全 orDie を覆う** — 応答スキーマ違反 (下の orDie)、
 * DB 行の復元失敗、ハッシュ形式の破れ、いずれも同じ経路を通る。
 */
const handle =
  <A, Req extends RequestSchemas, R>(
    request: Req,
    controller: (
      input: ControllerInput<Req>,
    ) => Effect.Effect<A, ApplicationError, R>,
    respond: (c: Context, value: A) => Effect.Effect<Response>,
  ) =>
  (
    runtime: ManagedRuntime.ManagedRuntime<
      R | UuidGenerator | AccessTokenIssuer,
      never
    >,
  ): Handler =>
  async (c) =>
    await runtime.runPromise(
      Effect.gen(function* () {
        // 契約違反で弾かれるリクエストもログに残せるよう、ID は先に確定させる。
        const requestId = yield* resolveRequestId(c);
        c.header(HttpHeader.RequestId, requestId);

        return yield* validateRequest(c, request).pipe(
          Effect.flatMap(controller),
          Effect.flatMap((value) => respond(c, value)),
          Effect.catchAll((error) => {
            const response = handleErrorResponse(error);
            return logFailure(c, requestId, response.status, error).pipe(
              Effect.map(() => c.json(response.body, response.status)),
            );
          }),
          // 記録と応答を分けているのは、tapDefect が Cause (スタックを持つ) を、
          // catchAllDefect が defect そのものを渡すため。原因を厚く残せる前者で記録する。
          Effect.tapDefect((cause) => logDefect(c, requestId, cause)),
          Effect.catchAllDefect(() =>
            Effect.succeed(c.json(defectResponse.body, defectResponse.status)),
          ),
        );
      }),
    );

/**
 * 本文ありの仕様かを判定する。
 *
 * `"body" in spec.response` を呼び出し側で直接書くと spec 全体が絞り込まれず、
 * controller の型 (void を返す版 / 値を返す版) が union のまま残ってしまう。
 * spec ごと絞るために型述語にしている。
 */
const isContentful = <A, ResponseA, ResponseI, Req extends RequestSchemas, R>(
  spec: NoContentSpec<Req, R> | ContentfulSpec<A, ResponseA, ResponseI, Req, R>,
): spec is ContentfulSpec<A, ResponseA, ResponseI, Req, R> =>
  "body" in spec.response;

/**
 * ユースケースの Effect から HTTP ハンドラを組み立てる。
 *
 * 宣言は request / response / controller の 3 つ。**HTTP 契約の入出力が
 * そのまま読める形**にしてある。
 *
 * - **request** … 検証する入力源。宣言したものだけが検証され、controller に渡る
 * - **response** … `status: HttpStatus.NoContent` なら本文なし (body を受け付けない)、
 *   それ以外は body が必須 (書き忘れ・書きすぎがどちらもコンパイルエラー)
 * - **controller** … 検証済みの入力を受け取り、応答の中身を返す
 *
 * 応答ボディは返す直前に API 契約 (生成スキーマ) で検証する。
 * 契約とずれた応答はバグなので defect (orDie) として扱い、早期に気付けるようにする
 * (クライアントへは handle の受け皿が契約どおりの 500 に翻訳する)。
 *
 * 戻り値は Handler ではなく「ランタイムを受け取ると Handler になる関数」。
 * Effect は R (依存) が解決されるまで実行できず、その解決を行うのが
 * ManagedRuntime なので、どの実装で動かすかは組み立て時 (*-routes.ts) に決める。
 * ここでランタイムを import してしまうと本番の Layer が焼き付き、
 * テストで差し替えられなくなる。
 *
 * 必要な依存 R は controller から推論され、ランタイム側が R を満たさなければ
 * 呼び出し箇所でコンパイルエラーになる (渡し忘れを型で防ぐ)。
 * 相関 ID の採番に UuidGenerator を使うため、R に加えてこれも要求する。
 *
 * なお 204 側の controller を `Effect<void, ...>` としているが、これは値を返す
 * controller を弾けない (TypeScript では戻り値 void の関数型が任意の戻り値を
 * 受け入れるため)。実害はなく、204 の応答組み立てでは戻り値を捨てる。
 */
export const handleWithEffect = <
  A,
  ResponseA,
  ResponseI,
  Req extends RequestSchemas,
  R,
>(
  spec: NoContentSpec<Req, R> | ContentfulSpec<A, ResponseA, ResponseI, Req, R>,
): ((
  runtime: ManagedRuntime.ManagedRuntime<
    R | UuidGenerator | AccessTokenIssuer,
    never
  >,
) => Handler) => {
  if (isContentful(spec)) {
    const { status, body: bodySchema } = spec.response;
    return handle(spec.request, spec.controller, (c, value) =>
      Schema.decodeUnknown(bodySchema)(value).pipe(
        Effect.orDie,
        Effect.map((decoded) => c.json(decoded as object, status)),
      ),
    );
  }

  const { status } = spec.response;
  return handle(spec.request, spec.controller, (c) =>
    Effect.succeed(c.body(null, status)),
  );
};
