import type { SqlState } from "./constants/sql-state";

/**
 * 例外から PostgreSQL のエラー情報を取り出すヘルパー。
 *
 * Bun.sql は PostgresError を投げ、SQLSTATE は `code` ではなく `errno` に入る
 * (`code` は "ERR_POSTGRES_SERVER_ERROR" という Bun 独自の文字列)。
 * さらに Drizzle は DrizzleQueryError でラップするため、cause を辿って判定する。
 *
 * ここが担うのは**包みを剥がして取り出す**ところまで。取り出した値の意味付けは、
 * 語彙が constants/ に、ログ用の丸めが classify-db-failure.ts にある。
 */

/** PostgresError のうち、判定に使うフィールド。 */
type PostgresErrorLike = {
  readonly errno: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly detail?: string;
};

const isPostgresErrorLike = (value: unknown): value is PostgresErrorLike =>
  typeof value === "object" &&
  value !== null &&
  "errno" in value &&
  typeof (value as { errno: unknown }).errno === "string";

/**
 * 例外の cause を辿り、最初に pick が値を返したところで止める。
 *
 * ドライバの例外は DrizzleQueryError → PostgresError のように包まれて届くため、
 * 一番外側だけを見る判定では取りこぼす。包みの深さを呼び出し側に意識させないよう、
 * 辿る動作をここに閉じ込める (辿り方は 1 つで、変わるのは何を探すかだけ)。
 */
export const findInCauseChain = <A>(
  error: unknown,
  pick: (value: unknown) => A | undefined,
): A | undefined => {
  let current: unknown = error;
  while (current !== null && current !== undefined) {
    const found = pick(current);
    if (found !== undefined) return found;
    if (typeof current !== "object" || !("cause" in current)) return undefined;
    current = (current as { cause: unknown }).cause;
  }
  return undefined;
};

/**
 * 例外 (ラップされている場合は cause を辿る) から PostgresError を取り出す。
 * 見つからなければ undefined。
 */
export const findPostgresError = (
  error: unknown,
): PostgresErrorLike | undefined =>
  findInCauseChain(error, (value) =>
    isPostgresErrorLike(value) ? value : undefined,
  );

/**
 * 指定の SQLSTATE 違反かどうかを判定する。
 * constraint を渡した場合はその制約名に一致するものだけを対象にする。
 *
 * 制約違反をドメインのエラーへ翻訳する側 (例: UserRepositoryLive の
 * handleMailAddressDuplicationError) が使う。分類 (classify-db-failure.ts) とは経路が別で、
 * あちらはログのための丸め、こちらは応答を変えるための判定。
 */
export const isSqlStateViolation = (
  error: unknown,
  sqlState: SqlState,
  constraint?: string,
): boolean => {
  const postgresError = findPostgresError(error);
  if (postgresError === undefined) return false;
  if (postgresError.errno !== sqlState) return false;
  return constraint === undefined || postgresError.constraint === constraint;
};
