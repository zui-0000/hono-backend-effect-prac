import { Cause, Effect } from "effect";
import type { Context } from "hono";

import { HttpStatus } from "../constants/http-status";
import type { ApplicationError } from "./handle-error-response";

/**
 * 失敗をサーバーログに残す。**外に返さないことを、ここで補う。**
 *
 * 応答はエラーコードと定型メッセージだけなので、原因を辿る手掛かりは
 * ログにしかない。相関 ID を応答ヘッダと共有することで、
 * 特定の問い合わせからログを引ける。
 */

/**
 * インフラ由来の失敗だけが持つ情報 (原因と内訳)。いずれも外部には出さない。
 *
 * failure / sqlState があると「DB が落ちている」と「マイグレーション漏れ」を
 * ログ側で切り分けられる。errorTag だけでは全部 RepositoryError に埋もれる。
 *
 * 値が無いキーは落とす。annotateLogs は undefined をそのまま `sqlState=undefined` と
 * 出力してしまい、検索の邪魔になるため (接続断は SQLSTATE を持たない)。
 */
const infraContext = (error: ApplicationError): Record<string, unknown> =>
  error._tag === "RepositoryError"
    ? {
        failure: error.failure,
        ...(error.sqlState === undefined ? {} : { sqlState: error.sqlState }),
        cause: String(error.cause),
      }
    : {};

/**
 * 失敗したリクエストをログに記録する。
 *
 * 外部にはエラーコードと定型メッセージしか返さないため、
 * 「実際に何が起きていたか」はここでサーバーログに残す。
 * 相関 ID (requestId) を応答ヘッダと共有することで、
 * 特定の問い合わせからログを引けるようにする。
 *
 * 5xx になるインフラ由来の失敗は原因 (cause) まで記録し、
 * 4xx となるクライアント起因の失敗は warn として概要のみ残す。
 */
export const logFailure = (
  c: Context,
  requestId: string,
  status: number,
  error: ApplicationError,
): Effect.Effect<void> => {
  const context = {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status,
    errorTag: error._tag,
  };

  const log =
    status >= 500
      ? Effect.logError("リクエストの処理に失敗しました").pipe(
          Effect.annotateLogs({ ...context, ...infraContext(error) }),
        )
      : Effect.logWarning("リクエストを受け付けられませんでした").pipe(
          Effect.annotateLogs(context),
        );

  return log;
};

/**
 * 型付きエラーに翻訳できなかった失敗 (defect) を記録する。
 *
 * defect は E チャネルに現れないため logFailure では拾えない。放っておくと
 * catchAll をすり抜けて runPromise が reject し、Hono 既定の平文 500 が返って
 * **相関 ID の付いたログが 1 行も残らない**。ここが最後の受け皿になる。
 *
 * 原因は Cause.pretty でスタックごと残す。defect は「起きてはいけないこと」で、
 * 外部には定型の 500 しか返さない以上、原因を辿る手掛かりはログにしかない。
 */
export const logDefect = (
  c: Context,
  requestId: string,
  cause: Cause.Cause<never>,
): Effect.Effect<void> =>
  Effect.logError("リクエストの処理が異常終了しました").pipe(
    Effect.annotateLogs({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: HttpStatus.InternalServerError,
      defect: Cause.pretty(cause),
    }),
  );
