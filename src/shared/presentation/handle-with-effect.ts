import { Effect, type ManagedRuntime } from "effect";
import type { Handler } from "hono";

import type { AccessTokenIssuer } from "~/shared/domain/access-token-issuer";
import type { UuidGenerator } from "~/shared/domain/uuid-generator";

import { HttpStatus } from "./constants/http-status";
import type { ApplicationError } from "./handler/handle-error-response";
import { handleFailures } from "./handler/handle-failures";
import {
  type ControllerInput,
  type RequestSchemas,
  validateRequest,
} from "./handler/validate-request";
import { verifyAuth } from "./handler/verify-bearer";
import type { RequestIdEnv } from "./resolve-request-id";
import type { SuccessResponse } from "./success-response";

/**
 * エンドポイントの宣言。**キーが実行の段と 1 対 1 で対応する。**
 *
 *   auth       → verifyAuth        （省くと認証しない）
 *   request    → validateRequest
 *   controller → controller
 *
 * 応答は controller が `SuccessResponse` で組み立てて返す。ここには現れない
 * （経緯は docs/02-architecture.md）。
 *
 * `auth` を `request` の中に入れないのは、あちらが「入力源 → スキーマ」の表で、
 * 認証だけスキーマを持たないため。契約の `@useAuth(BearerAuth)` と 1 対 1。
 */
type Spec<Req extends RequestSchemas, Auth extends true | undefined, R> = {
  readonly auth?: Auth;
  readonly request: Req;
  readonly controller: (
    input: ControllerInput<Req, Auth>,
  ) => Effect.Effect<SuccessResponse, ApplicationError, R>;
};

/**
 * 共通の実行部。成功時の応答の作り方 (respond) だけを呼び出し側から受け取る。
 *
 * 実行の流れ。**責務ごとに 1 段ずつ並べてある。**
 *   1. 認証する            (verifyAuth。宣言が無い経路では何もしない)
 *   2. 契約で検証する      (validateRequest)
 *   3. controller を実行する
 *   4. HTTP 応答に変換する (respond)
 *   5. 失敗と defect を畳む (handleFailures が全体を包む)
 *
 * **認証が先。** 通っていない相手には契約の話を一切しない
 * (400 の details はフィールド名と制約をそのまま返すため)。
 *
 * 相関 ID は**採番しない**。`requestContext` middleware が全リクエストで確定させた
 * ものを読むだけ。2 箇所で採番すると、受け取った値が使えないときに
 * 応答ヘッダとログへ別々の ID が載る。
 */
const handle =
  <Req extends RequestSchemas, Auth extends true | undefined, R>(
    auth: Auth | undefined,
    request: Req,
    controller: (
      input: ControllerInput<Req, Auth>,
    ) => Effect.Effect<SuccessResponse, ApplicationError, R>,
  ) =>
  (
    runtime: ManagedRuntime.ManagedRuntime<
      R | UuidGenerator | AccessTokenIssuer,
      never
    >,
  ): Handler<RequestIdEnv> =>
  async (c) =>
    await runtime.runPromise(
      Effect.gen(function* () {
        const authenticated = yield* verifyAuth(c, auth);
        const validated = yield* validateRequest(c, request);
        const responded = yield* controller({
          ...validated,
          ...authenticated,
          c,
        } as ControllerInput<Req, Auth>);

        // 204 は本文を持てないので c.json を通さない。通すと本文が空でも
        // Content-Type: application/json が載り、中身があると名乗る応答になる。
        return responded.status === HttpStatus.NoContent
          ? c.body(null, responded.status)
          : c.json(responded.body as object, responded.status);
      }).pipe(handleFailures(c, c.get("requestId"))),
    );

/**
 * ユースケースの Effect から HTTP ハンドラを組み立てる。
 *
 * 宣言は auth / request / controller の 3 つ。**HTTP 契約の入力が
 * そのまま読める形**にしてある。**HTTP 契約の入出力が
 * そのまま読める形**にしてある。
 *
 * - **auth** … `true` なら Bearer を検証し、claims を controller の入力に載せる
 *   （省略した経路では `auth` が型に現れない）
 * - **request** … 検証する入力源（`RequestSchemas`）。宣言したものだけが
 *   検証され、controller に渡る
 * - **controller** … 検証済みの入力を受け取り、応答の中身を返す
 *
 * このファイルが持つのは**組み立てだけ**。入力の検証は request-validator が、
 * 失敗の翻訳と defect の受け皿は handle-failures が持つ。
 *
 * 応答は controller が `SuccessResponse.Ok` などで組み立てる。契約スキーマの検証も
 * そちらで行い、ズレは defect になる (クライアントへは handleFailures が
 * 契約どおりの 500 を返す)。
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
 */
export const handleWithEffect = <
  Req extends RequestSchemas,
  R,
  Auth extends true | undefined = undefined,
>(
  spec: Spec<Req, Auth, R>,
): ((
  runtime: ManagedRuntime.ManagedRuntime<
    R | UuidGenerator | AccessTokenIssuer,
    never
  >,
) => Handler<RequestIdEnv>) => handle(spec.auth, spec.request, spec.controller);
