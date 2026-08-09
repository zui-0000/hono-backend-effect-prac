import { Schema } from "effect";

/**
 * PHC 文字列形式 (Password Hashing Competition) の頭。`$<識別子>$...` で始まる。
 * argon2id (`$argon2id$`) も bcrypt (`$2b$`) も scrypt も共通で従う規約なので、
 * 特定のアルゴリズムを名指しせずに「ハッシュの形をしているか」だけを見られる。
 */
const PHC_PATTERN = /^\$[a-z0-9-]+\$/u;

/**
 * ハッシュ済みパスワード (値オブジェクト / 不透明な branded string)。
 * ドメインは平文を持たず、ハッシュ化・検証は PasswordHasher が担う。
 * ここは成果物であるハッシュ文字列を包む不透明な値として扱う。
 * エクスポート名は所属する集約で修飾する (UserHashedPassword)。
 *
 * 防ぎたいのは**平文がこの欄に入る事故** (ハッシュ化を挟み忘れる)。
 * 長さでは分離できない: 平文は 12〜128 文字で、argon2id は 118 文字、
 * bcrypt は 60 文字と、どちらも平文の許容範囲にすっぽり収まる。
 * そのため長さではなく形式で見る。平文が偶然 `$` で始まる確率は無視できる。
 *
 * 不透明とは「中身を解釈しない」ことであって「何でも受け取る」ことではない。
 * 同じ考え方は Uuid (不透明な識別子だが形式は検証する) でも採っている。
 */
export const UserHashedPassword = Schema.String.pipe(
  Schema.pattern(PHC_PATTERN),
  Schema.brand("User.HashedPassword"),
);
export type UserHashedPassword = typeof UserHashedPassword.Type;
