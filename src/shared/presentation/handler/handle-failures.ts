import { Effect } from "effect";
import type { Context } from "hono";

import {
  type ApplicationError,
  defectResponse,
  handleErrorResponse,
} from "./handle-error-response";
import { logDefect, logFailure } from "./log-failure";

/**
 * 応答を組み立てる Effect の**いちばん外側**に置き、失敗をすべて応答へ畳む。
 *
 * 2 種類の失敗を受ける。
 *
 * - **型付きエラー** (`ApplicationError`) … `handleErrorResponse` が HTTP へ翻訳する
 * - **defect** (`orDie` / `die` で落としたもの) … E チャネルに現れないので
 *   `catchAll` では拾えない。放っておくと `runPromise` が reject して Hono 既定の
 *   平文 500 が返り、契約と違う形になったうえログも残らない
 *
 * **この受け皿 1 つで全 `orDie` を覆う** — 応答スキーマ違反、DB 行の復元失敗、
 * ハッシュ形式の破れ、いずれも同じ経路を通る。
 *
 * 記録と応答を分けているのは、`tapDefect` が `Cause` (スタックを持つ) を、
 * `catchAllDefect` が defect そのものを渡すため。原因を厚く残せる前者で記録する。
 *
 * 内部で何が起きたかはログにだけ残し、外部には定型メッセージを返す。
 * 相関 ID は応答ヘッダとログの双方に載るので、フロントエンドのログと突き合わせられる。
 *
 * `handleErrorResponse` との違いは形。あちらは **エラー 1 つを応答へ写す純粋な表**で、
 * こちらは **Effect の失敗経路そのものを畳む pipeable**。
 * `infrastructure` の `handleDbError` と同じ立ち位置にある。
 */
export const handleFailures =
  (c: Context, requestId: string) =>
  <R>(
    effect: Effect.Effect<Response, ApplicationError, R>,
  ): Effect.Effect<Response, never, R> =>
    effect
      .pipe(
        Effect.catchAll((error) => {
          const response = handleErrorResponse(error);
          return logFailure(c, requestId, response.status, error).pipe(
            Effect.map(() => c.json(response.body, response.status)),
          );
        }),
      )
      .pipe(Effect.tapDefect((cause) => logDefect(c, requestId, cause)))
      .pipe(
        Effect.catchAllDefect(() =>
          Effect.succeed(c.json(defectResponse.body, defectResponse.status)),
        ),
      );
