import type { NotFoundHandler } from "hono";

import { ResourceNotFoundError } from "~/shared/errors/resource-not-found-error";

import { handleErrorResponse } from "./handler/handle-error-response";
import type { RequestIdEnv } from "./resolve-request-id";

/**
 * どの経路にもマッチしなかったときの応答。
 *
 * Hono 既定は平文の `404 Not Found` で、契約のエラー本文と形が違う。
 * クライアントから見れば「存在しない id を指定した 404」と同じ状況なので、
 * 同じ `errorCode` / `message` を返して形を揃える。
 *
 * **専用コード (4041) は作らない。** 独自採番はクライアントが分岐する必要のある
 * 事由に限る、というのがこの API の線引きで、経路の打ち間違いは誰も分岐しない
 * (詳細は `constants/error-code.ts`)。
 *
 * 本文の組み立ては `handler/handle-error-response.ts` に任せる。
 * **翻訳表を 1 箇所に保つ**ため。これ自体が Hono の `NotFoundHandler` なので、
 * `handler/` の部品を使うのは自然。
 *
 * 相関 ID は `resolveRequestId` が既に応答ヘッダへ載せている。
 */
export const handleNotFound: NotFoundHandler<RequestIdEnv> = (c) => {
  const { status, body } = handleErrorResponse(new ResourceNotFoundError());
  return c.json(body, status);
};
