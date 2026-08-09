import { Effect, type ManagedRuntime, Schema } from "effect";
import type { Context, Handler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { AccessTokenIssuer } from "~/shared/domain/access-token-issuer";
import type { UuidGenerator } from "~/shared/domain/uuid-generator";

import { HttpStatus } from "./constants/http-status";
import type { ApplicationError } from "./handle-error-response";
import { handleFailures } from "./handle-failures";
import type { RequestContextEnv } from "./request-context";
import {
  type ControllerInput,
  type RequestSchemas,
  validateRequest,
} from "./request-validator";

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
 * 共通の実行部。成功時の応答の作り方 (respond) だけを呼び出し側から受け取る。
 *
 * 実行の流れ:
 *   1. リクエストを API 契約で検証する (validateRequest)
 *   2. controller を実行する
 *   3. 結果を HTTP 応答に変換する (respond)
 *   4. 失敗と defect を応答へ畳む (handleFailures)
 *
 * 相関 ID は**採番しない**。`requestContext` middleware が全リクエストで確定させた
 * ものを読むだけ。2 箇所で採番すると、受け取った値が使えないときに
 * 応答ヘッダとログへ別々の ID が載る。
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
  ): Handler<RequestContextEnv> =>
  async (c) =>
    await runtime.runPromise(
      Effect.gen(function* () {
        const requestId = c.get("requestId");

        return yield* validateRequest(c, request).pipe(
          Effect.flatMap(controller),
          Effect.flatMap((value) => respond(c, value)),
          handleFailures(c, requestId),
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
 * - **request** … 検証する入力源（`RequestSchemas`）。宣言したものだけが
 *   検証され、controller に渡る
 * - **response** … `status: HttpStatus.NoContent` なら本文なし (body を受け付けない)、
 *   それ以外は body が必須 (書き忘れ・書きすぎがどちらもコンパイルエラー)
 * - **controller** … 検証済みの入力を受け取り、応答の中身を返す
 *
 * このファイルが持つのは**組み立てだけ**。入力の検証は request-validator が、
 * 失敗の翻訳と defect の受け皿は handle-failures が持つ。
 *
 * 応答ボディは返す直前に API 契約 (生成スキーマ) で検証する。
 * 契約とずれた応答はバグなので defect (orDie) として扱い、早期に気付けるようにする
 * (クライアントへは handleFailures が契約どおりの 500 に翻訳する)。
 *
 * 戻り値は Handler ではなく「ランタイムを受け取ると Handler になる関数」。
 * Effect は R (依存) が解決されるまで実行できず、その解決を行うのが
 * ManagedRuntime なので、どの実装で動かすかは組み立て時 (*-routes.ts) に決める。
 * ここでランタイムを import してしまうと本番の Layer が焼き付き、
 * テストで差し替えられなくなる。
 *
 * 必要な依存 R は controller から推論され、ランタイム側が R を満たさなければ
 * 呼び出し箇所でコンパイルエラーになる (渡し忘れを型で防ぐ)。
 * 相関 ID の採番に UuidGenerator を、Bearer の検証に AccessTokenIssuer を使うため、
 * R に加えてこの 2 つも要求する。
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
) => Handler<RequestContextEnv>) => {
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
