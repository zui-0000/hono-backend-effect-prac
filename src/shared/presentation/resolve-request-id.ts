import { Effect, type ManagedRuntime } from "effect";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

import { UuidGenerator } from "~/shared/domain/uuid-generator";

import { HttpHeader } from "./constants/http-header";

/**
 * 相関 ID を持ち回るための Hono の型。
 *
 * `createMiddleware` に宣言した `Variables` は、チェーンした先のハンドラまで
 * 交差型で伝播する。`c.get("requestId")` が `string` になるのはこのため。
 */
export type RequestIdEnv = {
  Variables: {
    readonly requestId: string;
  };
};

/**
 * 以下 2 つはヘッダ名ではなく「ログに載せて安全か」の判定基準。
 * 契約が要求する形式 (uuid v7) とは**別物**で、そちらの検証は
 * `handler/validate-request.ts` が行う。
 */

/** 受け取った相関 ID として許容する最大長 (ログ肥大化を防ぐ)。 */
const MAX_LENGTH = 128;

/** ログに混入させない文字を除いた、安全な相関 ID の形式。 */
const SAFE_PATTERN = /^[\w.-]+$/;

/**
 * **全リクエストの最外周。** 相関 ID を確定させ、下流と応答ヘッダへ配る。
 *
 * ## なぜ middleware なのか
 *
 * `handleWithEffect` は**マッチした経路でしか走らない**。パスの打ち間違いも
 * 許可されないメソッドも `/health` も、相関 ID もログも無いまま Hono 既定の
 * 平文 404 になっていた（実測で確認）。調べたい場面でちょうど手掛かりが消える。
 * 認証や契約検証と違い、**ここにしか置けない**仕事なのでこれだけを外に出した。
 *
 * ## なぜ契約検証と二重に見えるのか
 *
 * `X-Request-Id` は契約でも必須（uuid v7）で、そちらは 400 で弾く。
 * **役割が正反対**なので同居できない。
 *
 * | | この関数 | 契約検証 (validate-request) |
 * | --- | --- | --- |
 * | 目的 | ログに載せる ID を必ず用意する | 契約の遵守を強制する |
 * | 基準 | ログに載せて安全か（128 文字・`[\w.-]`） | uuid v7 か |
 * | 失敗 | **しない**（採番で代替） | 400 で弾く |
 * | 走る範囲 | 全リクエスト | マッチした経路の、認証を通った後 |
 *
 * 400 / 401 / 404 のいずれも `validate-request` に到達しないか、到達前に落ちる。
 * それでもログには ID が要るので、**先に必ず走る場所**が別に要る。
 * `shared/` は `~/generated` を参照できない（lint）ので、こちらが契約の
 * 正規表現を再利用することも構造上できない。
 *
 * 外部由来の値をそのままログに載せるとログインジェクションの恐れがあるため、
 * 長さと文字種を検めて、条件を満たさないものは採番した値で置き換える。
 */
export const resolveRequestId = (
  runtime: ManagedRuntime.ManagedRuntime<UuidGenerator, never>,
): MiddlewareHandler<RequestIdEnv> =>
  createMiddleware<RequestIdEnv>(async (c, next) => {
    const incoming = c.req.header(HttpHeader.RequestId);
    const requestId = await runtime.runPromise(
      incoming !== undefined &&
        incoming.length <= MAX_LENGTH &&
        SAFE_PATTERN.test(incoming)
        ? Effect.succeed(incoming)
        : Effect.flatMap(UuidGenerator, (generator) => generator.next),
    );

    c.set("requestId", requestId);

    await next();

    // next() の後に載せる。ハンドラが c.json などで応答を作り直すため、
    // 前に置くと上書きされうる。
    c.header(HttpHeader.RequestId, requestId);
  });
