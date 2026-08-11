import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Option, Schema } from "effect";

import { MailAddressDuplicationError } from "~/shared/errors/mail-address-duplication-error";
import type { RepositoryError } from "~/shared/errors/repository-error";
import { Database } from "~/shared/infrastructure/db/database-client";
import { SqlState } from "~/shared/infrastructure/db/error/constants/sql-state";
import { handleDbError } from "~/shared/infrastructure/db/error/handle-db-error";
import { isSqlStateViolation } from "~/shared/infrastructure/db/error/postgres-error-reader";

import { User } from "../domain/model/user";
import { UserRepository } from "../domain/user-repository";
import { tUser } from "./drizzle-schema";

// t_user のメールアドレス一意索引 (migration が生成した名前)。
// 列ではなく lower(mail_address) に張ってあるため、名前も _lower_ を含む。
const MAIL_ADDRESS_UNIQUE_CONSTRAINT = "t_user_mail_address_lower_unique";

/**
 * 一意制約違反を MailAddressDuplicationError (409) に翻訳する。
 * handleDbError の上に pipe で積んで使う (翻訳の段数がそのまま並ぶ)。
 *
 * アプリ側の事前チェックをすり抜けた同時実行 (TOCTOU) を DB の制約が捕まえる
 * 「最後の砦」の経路。他の失敗は RepositoryError (500) のまま素通しする。
 * 制約名も翻訳先も user 固有のため handleDbError のようには共有しない。
 */
const handleMailAddressDuplicationError =
  (user: User) =>
  <A, R>(
    effect: Effect.Effect<A, RepositoryError, R>,
  ): Effect.Effect<A, MailAddressDuplicationError | RepositoryError, R> =>
    effect.pipe(
      Effect.catchIf(
        (error) =>
          isSqlStateViolation(
            error.cause,
            SqlState.UniqueViolation,
            MAIL_ADDRESS_UNIQUE_CONSTRAINT,
          ),
        () =>
          new MailAddressDuplicationError({ mailAddress: user.mailAddress }),
      ),
    );

/**
 * 検索結果の先頭行を User 集約に復元する (0 件なら Option.none)。
 * 行の型がそのまま User.Encoded なので、列ごとに組み立てず丸ごと decode する。
 * DB の値は既に妥当な前提のため decode 失敗は defect 扱い。
 */
const toDomainHead = (
  rows: readonly (typeof tUser.$inferSelect)[],
): Effect.Effect<Option.Option<User>> =>
  Option.fromNullable(rows[0])
    .pipe(Option.map((row) => Schema.decode(User)(row).pipe(Effect.orDie)))
    .pipe(Effect.transposeOption);

/**
 * UserRepository の Drizzle 実装 (アダプタ)。
 * ポート (domain/user-repository.ts) に対する具体実装で、Layer として注入する。
 * 接続は import で掴まず Database から受け取るため succeed ではなく effect を使う。
 */
export const UserRepositoryLive = Layer.effect(
  UserRepository,
  Effect.gen(function* () {
    const db = yield* Database;

    return {
      create: (user) =>
        Effect.tryPromise(() =>
          db.insert(tUser).values({
            id: user.id,
            name: user.name,
            mailAddress: user.mailAddress,
            hashedPassword: user.hashedPassword,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          }),
        )
          .pipe(handleDbError)
          .pipe(handleMailAddressDuplicationError(user))
          .pipe(Effect.asVoid),

      // set に並べるのは「その遷移が変える項目」だけ。触らない列を書き戻さないことが
      // 分けた理由そのものなので、ここに項目を足すときはポートの doc を読むこと。
      updateProfile: (user) =>
        Effect.tryPromise(() =>
          db
            .update(tUser)
            .set({
              name: user.name,
              mailAddress: user.mailAddress,
              updatedAt: user.updatedAt,
            })
            .where(eq(tUser.id, user.id)),
        )
          .pipe(handleDbError)
          .pipe(handleMailAddressDuplicationError(user))
          .pipe(Effect.asVoid),

      // メールアドレスを書かないので一意制約違反は起こりえない (翻訳を積まない)。
      updatePassword: (user) =>
        Effect.tryPromise(() =>
          db
            .update(tUser)
            .set({
              hashedPassword: user.hashedPassword,
              updatedAt: user.updatedAt,
            })
            .where(eq(tUser.id, user.id)),
        )
          .pipe(handleDbError)
          .pipe(Effect.asVoid),

      findById: (id) =>
        Effect.tryPromise(() =>
          db.select().from(tUser).where(eq(tUser.id, id)).limit(1),
        )
          .pipe(handleDbError)
          .pipe(Effect.flatMap(toDomainHead)),

      // 大小を無視して引く。保存は入力どおりなので eq では
      // Taro.Yamada@... と taro.yamada@... が別物になり、本人を見つけられない。
      // 比較の形は drizzle-schema の一意索引 lower(mail_address) と揃えてある
      // (揃っていないと索引が使われず全表走査になる)。
      findByMailAddress: (mailAddress) =>
        Effect.tryPromise(() =>
          db
            .select()
            .from(tUser)
            .where(sql`lower(${tUser.mailAddress}) = lower(${mailAddress})`)
            .limit(1),
        )
          .pipe(handleDbError)
          .pipe(Effect.flatMap(toDomainHead)),

      deleteById: (id) =>
        Effect.tryPromise(() => db.delete(tUser).where(eq(tUser.id, id)))
          .pipe(handleDbError)
          .pipe(Effect.asVoid),
    };
  }),
);
