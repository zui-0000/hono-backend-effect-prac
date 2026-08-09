import { Schema } from "effect";

// schema の MailAddress と同一パターン (RFC 5322 準拠)。
const MAIL_ADDRESS_PATTERN =
  /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/u;

/**
 * メールアドレス (値オブジェクト / branded string)。
 * decode 時に小文字化 (Schema.Lowercase) してから長さ・形式を検証する。
 *
 * メアドは実運用上ほぼ case-insensitive (ドメイン部は DNS 仕様で大小無視、
 * ローカル部も主要プロバイダは区別しない)。一方でユーザー入力は大文字混じりで来る。
 * VO の入口で小文字へ正規化することで、重複判定・検索を DB の unique index で完結させ、
 * 「大小違いで重複登録」「ログインで引けない」を防ぐ。
 */
export const MailAddress = Schema.Lowercase.pipe(
  Schema.maxLength(255),
  Schema.pattern(MAIL_ADDRESS_PATTERN),
  Schema.brand("MailAddress"),
);
export type MailAddress = typeof MailAddress.Type;
