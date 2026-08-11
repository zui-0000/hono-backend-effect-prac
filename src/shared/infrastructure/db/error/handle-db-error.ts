import { type Cause, Effect } from "effect";

import { RepositoryError } from "~/shared/errors/repository-error";

import { classifyDbFailure } from "./classify-db-failure";

/**
 * DB 操作の失敗を RepositoryError (型付きエラー) に翻訳する。
 * 内訳 (failure / sqlState) は classifyDbFailure が埋める。外には出さずログにだけ残る。
 *
 * infrastructure における「失敗をこの層の語彙に直す窓口」で、presentation の
 * handleErrorResponse と対になる位置にある。
 *
 * Effect.tryPromise を内側に隠さず pipe で受けるのは、翻訳の段を揃えるため。
 * 隠すと汎用の翻訳だけがラッパになり、集約固有の翻訳 (handleMailAddressDuplicationError) と
 * 形が食い違う。持ち上げ → 翻訳 → 翻訳、と並べば読む順と処理の順が一致する。
 *
 * UnknownException から error を取り出して渡しているのは、classifyDbFailure と
 * isSqlStateViolation が cause を辿って PostgresError を探すため。
 * 包みを 1 枚増やさず、ドライバが投げた例外そのものを渡す。
 */
export const handleDbError = <A, R>(
  effect: Effect.Effect<A, Cause.UnknownException, R>,
): Effect.Effect<A, RepositoryError, R> =>
  Effect.mapError(
    effect,
    ({ error }) =>
      new RepositoryError({ ...classifyDbFailure(error), cause: error }),
  );
