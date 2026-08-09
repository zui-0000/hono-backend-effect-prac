import { Schema } from "effect";

/** SHA-256 を 16 進で表した形 (64 文字)。 */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * リフレッシュトークンのハッシュ (値オブジェクト / branded string)。
 *
 * **保存するのは券そのものではなくこれ。** DB が漏れても、載っているのは
 * ハッシュだけなのでそのまま使われることはない。
 *
 * 防ぎたいのは **平文の券がこの欄に入る事故**。UserHashedPassword が
 * PHC 形式で平文を弾いているのと同じ発想で、こちらは SHA-256 の 16 進形式で見る。
 * 券は `rt_` 接頭辞付きの base64url なので、形式が重なることはない。
 *
 * ハッシュに argon2 を使わない理由は RefreshTokenIssuer の doc を参照
 * (守る対象が人間の作るパスワードではなく 256 bit の乱数なので、遅くする意味が無い)。
 */
export const RefreshTokenHash = Schema.String.pipe(
  Schema.pattern(SHA256_HEX_PATTERN),
  Schema.brand("Auth.RefreshTokenHash"),
);
export type RefreshTokenHash = typeof RefreshTokenHash.Type;
