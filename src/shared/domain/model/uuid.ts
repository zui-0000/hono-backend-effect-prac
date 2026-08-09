import { Schema } from "effect";

// UUID v7 の形式 (TypeSpec schema 側の Uuid と同一パターン)。
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * UUID v7 形式の文字列スキーマ (未 brand・共有ドメイン)。
 *
 * 各集約の id 値オブジェクトは、これに固有の brand を重ねて定義する:
 *   export const UserId = Uuid.pipe(Schema.brand("User.Id"));   // contexts/user 側
 *
 * これにより「uuidv7 という形式検証」は共有しつつ、
 * 集約ごとの id 型は名目的に区別 (UserId と OrderId を混用不可) に保つ。
 * brand タグ ("User.Id") はグローバルに一意であればよく、
 * エクスポート名 (UserId) と一致している必要はない。
 *
 * value-objects/ に入れていないのはそのため。このリポジトリで値オブジェクトの
 * 目印は brand (名目的型付け) であり、Uuid はそれを持たない。
 * 単体では意味を成さず、brand を重ねて初めて値オブジェクトになる素材なので、
 * 完成品 (MailAddress / Password) と同じ場所には置かない。
 */
export const Uuid = Schema.String.pipe(Schema.pattern(UUID_V7_PATTERN));
