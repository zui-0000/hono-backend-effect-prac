import { RepositoryFailure } from "~/shared/errors/repository-error";

import { FAILURE_BY_ERROR_CODE } from "./constants/failure-by-error-code";
import { FAILURE_BY_SQL_STATE_CLASS } from "./constants/failure-by-sql-state-class";
import { SqlState } from "./constants/sql-state";
import { findInCauseChain, findPostgresError } from "./postgres-error-reader";

/** 例外から、対応表に載っている code を探す (途中に code を持たない層があっても内側を見る)。 */
const findKnownErrorCode = (error: unknown): string | undefined =>
  findInCauseChain(error, (value) => {
    if (typeof value !== "object" || value === null || !("code" in value)) {
      return undefined;
    }
    const code = (value as { code: unknown }).code;
    return typeof code === "string" && code in FAILURE_BY_ERROR_CODE
      ? code
      : undefined;
  });

/**
 * DB 由来の例外を、ログ用の内訳へ分類する。
 *
 * 呼ぶのは infrastructure 層だけ (RepositoryError を組み立てる handleDbError)。
 * 分岐のためではなくログのための情報なので、分類できなければ Unknown で構わない
 * — 外に出る応答は、どの内訳でも同じ 500 になる。
 *
 * 併せて記録する sqlState は Postgres が返した生の値で、こちらは絶対に嘘をつかない。
 * failure のほうは対応表を引いた解釈なので、表が古ければ外れうる。
 * 分類を疑うときは sqlState から引き直せる (分類の目的は 01-database.md 参照)。
 *
 * 制約違反 (23xxx) はここへ来ない想定。来た場合は Unknown になるが、それは
 * 「ドメインのエラーへ翻訳し忘れている」というサインで、ログを見れば気付ける
 * (例: failure=unknown sqlState=23503 なら外部キー違反の扱いが抜けている)。
 */
export const classifyDbFailure = (
  error: unknown,
): { readonly failure: RepositoryFailure; readonly sqlState?: string } => {
  const postgresError = findPostgresError(error);

  if (postgresError === undefined) {
    // SQLSTATE が無い = サーバが応答する前に終わった。code で分類する。
    const code = findKnownErrorCode(error);
    return {
      failure:
        code === undefined
          ? RepositoryFailure.Unknown
          : (FAILURE_BY_ERROR_CODE[code] ?? RepositoryFailure.Unknown),
    };
  }

  const sqlState = postgresError.errno;

  // クラスで括ると質を取り違えるものだけ、先に個別で見る。
  // 57 は「管理操作」のクラスだが、57014 だけは時間切れ (statement_timeout)。
  if (sqlState === SqlState.QueryCanceled) {
    return { failure: RepositoryFailure.Timeout, sqlState };
  }

  return {
    failure:
      FAILURE_BY_SQL_STATE_CLASS[sqlState.slice(0, 2)] ??
      RepositoryFailure.Unknown,
    sqlState,
  };
};
