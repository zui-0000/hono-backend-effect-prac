import { Schema } from "effect";

// schema の MailAddress と同一パターン (RFC 5322 準拠)。
const MAIL_ADDRESS_PATTERN =
  /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/u;

/**
 * メールアドレス (値オブジェクト / branded string)。
 * **検証だけを行い、値は変えない。** 利用者が名乗った表記をそのまま持つ。
 *
 * ## なぜ小文字へ正規化しないか
 *
 * 一時期 `Schema.Lowercase` を挟んでいたが外した。潰すと元の表記を復元できない。
 * RFC 5321 §2.4 は SMTP 実装に「ローカル部の大小を保存せよ」と要求しており
 * (`MUST take care to preserve the case of mailbox local-parts`)、
 * 将来メールを送るとき、**届くかどうかを受信サーバの設定に賭ける**ことになる。
 * ドメイン部は DNS 仕様で必ず大小無視だが、ローカル部を区別する受信サーバは
 * 規格上ありうる。`Taro.Yamada@` の箱しか無いサーバに `taro.yamada@` で送れば
 * バウンスする。実務ではまず起きないが、**避けられる賭けをする理由が無い**。
 *
 * ## では大小違いの重複はどう防ぐか
 *
 * DB 側で `lower(mail_address)` に一意索引を張ってある
 * (`contexts/user/infrastructure/drizzle-schema.ts`)。検索も同じ形で引く。
 * 「保存は入力どおり・判定は大小無視」を、変換なしで両立させている。
 *
 * ## 比較するときの注意
 *
 * 正規化しないので、**MailAddress 同士を素の `===` で比べてはいけない**。
 * 大小違いが別物になる。現状ドメインに値同士の比較は無く、同一性の判定は
 * すべて DB (lower() 比較) 側にある。増やすときはここを思い出すこと。
 *
 * 大小を「同一とみなす」と決めた経緯そのものは、契約側の
 * `schema/src/shared/model/MailAddress.tsp` に残した。
 */
export const MailAddress = Schema.String.pipe(
  Schema.maxLength(255),
  Schema.pattern(MAIL_ADDRESS_PATTERN),
  Schema.brand("MailAddress"),
);
export type MailAddress = typeof MailAddress.Type;
