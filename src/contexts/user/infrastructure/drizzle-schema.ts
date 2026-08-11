import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * user コンテキストが所有するテーブル定義 (Drizzle スキーマ)。
 *
 * テーブルは所有するコンテキストの infrastructure に置く。集約 (User) と
 * その保存先 (t_user) の所有者を一致させることで、他コンテキストが
 * 直接この表を書き換える経路が「他コンテキストの infrastructure を import する」
 * という目に見える形になり、lint で機械的に禁じられる。
 *
 * 物理 DB とマイグレーションは 1 つ (リポジトリ直下の db/) のまま。
 * drizzle-kit は schema に glob を取れるので、コンテキストごとに分割しても
 * migration は全テーブルをまとめて 1 系列で管理できる。
 */

// 識別子はアプリ側 (ドメインの生成ファクトリ) で Bun.randomUUIDv7() を採番する。
// 集約が生成時点で identity を持つ DDD 王道の戦略のため、DB 側の DEFAULT は付けない。
export const tUser = pgTable(
  "t_user",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    // 利用者が入力した表記のまま保存する (大小を潰さない)。一意性は下の関数インデックスが担う。
    // 文字数上限は RFC 5321 の実質上限 254 に収まる 255。
    mailAddress: varchar("mail_address", { length: 255 }).notNull(),
    // パスワードのハッシュ (argon2id)。平文は保存しない。ハッシュ化はアプリ層 (Bun.password) が行う。
    hashedPassword: text("hashed_password").notNull(),
    // 作成/更新時刻はドメイン (User 集約) が Clock 経由で決める。
    // DB 側で上書きするとドメインが決めた値が失われるため、$onUpdate は付けない。
    // DEFAULT は直接 INSERT する場合の保険として残す。
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // メールアドレスの一意性は「大小を無視して」判定する。
    //
    // 列そのものに UNIQUE を張ると Postgres はバイト比較になり、
    // Taro.Yamada@example.co.jp と taro.yamada@example.co.jp が別人として通る。
    // 実運用では同一人物なので、同じ人が 2 アカウント持ててしまう。
    //
    // かといってアプリ側で小文字へ潰すと、利用者が名乗った表記が復元できなくなる。
    // RFC 5321 §2.4 は「ローカル部の大小を保存せよ」と言っており、将来メールを送る際に
    // 宛先の表記を相手のサーバ設定に賭けることになる (経緯は MailAddress.tsp)。
    //
    // 保存は入力どおり、一意判定だけ lower() で — が両立させる唯一の形。
    // 検索側 (findByMailAddress) も lower() で引くこと。揃っていないとこの索引が効かない。
    uniqueIndex("t_user_mail_address_lower_unique").on(
      sql`lower(${table.mailAddress})`,
    ),
  ],
);
