import type { ManagedRuntime } from "effect";
import type { MiddlewareHandler, NotFoundHandler } from "hono";
import { createMiddleware } from "hono/factory";

import type { UuidGenerator } from "~/shared/domain/uuid-generator";
import { ResourceNotFoundError } from "~/shared/errors/resource-not-found-error";

import { HttpHeader } from "./constants/http-header";
import { handleErrorResponse } from "./handle-error-response";
import { resolveRequestId } from "./request-log";

/**
 * 相関 ID を持ち回るための Hono の型。
 *
 * `createMiddleware` に宣言した `Variables` は、チェーンした先のハンドラまで
 * 交差型で伝播する。`c.get("requestId")` が `string` になるのはこのため。
 */
export type RequestContextEnv = {
  Variables: {
    readonly requestId: string;
  };
};

/**
 * **全リクエストの最外周**。相関 ID を確定させ、応答ヘッダに載せる。
 *
 * これだけを middleware にしているのは、**経路ごとのパイプラインでは覆えない**から。
 * `handleWithEffect` はマッチした経路でしか走らないので、パスの打ち間違いや
 * 許可されないメソッドは相関 ID もログも無いまま Hono 既定の平文 404 になる
 * （実測で確認した。`/health` も同じく素通りだった）。
 * **調べたい場面でちょうど手掛かりが消える**ので、ここは外に出すしかない。
 *
 * 逆に認証と契約検証は経路ごとに要否が変わるため、外に出さず
 * `handleWithEffect` の `request` 宣言に残している
 * （理由は [`04-backlog.md`](../../../docs/04-backlog.md)）。
 *
 * **採番するのはここだけ。** 受け取った値が使えないときは
 * `resolveRequestId` が採番で代替するので、2 箇所で呼ぶと
 * 応答ヘッダとログに別々の ID が載る。以降は `c.get("requestId")` を読む。
 */
export const requestContext = (
  runtime: ManagedRuntime.ManagedRuntime<UuidGenerator, never>,
): MiddlewareHandler<RequestContextEnv> =>
  createMiddleware<RequestContextEnv>(async (c, next) => {
    const requestId = await runtime.runPromise(resolveRequestId(c));
    c.set("requestId", requestId);

    await next();

    // next() の後に載せる。ハンドラが c.json などで応答を作り直すため、
    // 前に置くと上書きされうる。
    c.header(HttpHeader.RequestId, requestId);
  });

/**
 * どの経路にもマッチしなかったときの応答。
 *
 * Hono 既定は平文の `404 Not Found` で、契約のエラー本文と形が違う。
 * クライアントから見れば「存在しない id を指定した 404」と同じ状況なので、
 * 同じ `errorCode` / `message` を返して形を揃える
 * （本文の組み立ては `handleErrorResponse` に任せ、翻訳表を 1 箇所に保つ）。
 */
export const notFoundResponse: NotFoundHandler<RequestContextEnv> = (c) => {
  const { status, body } = handleErrorResponse(new ResourceNotFoundError());
  return c.json(body, status);
};
