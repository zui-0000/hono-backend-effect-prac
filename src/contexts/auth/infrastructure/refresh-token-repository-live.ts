import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Option, Schema } from "effect";

import { Database } from "~/shared/infrastructure/db/client";
import { handleDbFailure } from "~/shared/infrastructure/db/error/handle-db-failure";

import { RefreshToken, RevokedReason } from "../domain/model/refresh-token";
import { RefreshTokenRepository } from "../domain/refresh-token-repository";
import { tRefreshToken } from "./drizzle-schema";

/**
 * 検索結果の先頭行を RefreshToken 集約に復元する (0 件なら Option.none)。
 * 行の型がそのまま RefreshToken.Encoded なので、列ごとに組み立てず丸ごと decode する
 * (revoked_at の NULL は Option.none になる)。
 * DB の値は既に妥当な前提のため decode 失敗は defect 扱い。
 */
const toDomainHead = (
  rows: readonly (typeof tRefreshToken.$inferSelect)[],
): Effect.Effect<Option.Option<RefreshToken>> =>
  Option.fromNullable(rows[0]).pipe(
    Option.map((row) => Schema.decode(RefreshToken)(row).pipe(Effect.orDie)),
    Effect.transposeOption,
  );

/** 集約を行の形へ落とす。Encoded がそのまま insert の値になる。 */
const toRow = (token: RefreshToken): typeof tRefreshToken.$inferInsert =>
  Schema.encodeSync(RefreshToken)(token);

/**
 * RefreshTokenRepository の Drizzle 実装 (アダプタ)。
 * 接続は import で掴まず Database から受け取るため succeed ではなく effect を使う。
 */
export const RefreshTokenRepositoryLive = Layer.effect(
  RefreshTokenRepository,
  Effect.gen(function* () {
    const db = yield* Database;

    return {
      create: (token) =>
        Effect.tryPromise(() =>
          db.insert(tRefreshToken).values(toRow(token)),
        ).pipe(handleDbFailure, Effect.asVoid),

      findByTokenHash: (tokenHash) =>
        Effect.tryPromise(() =>
          db
            .select()
            .from(tRefreshToken)
            .where(eq(tRefreshToken.tokenHash, tokenHash))
            .limit(1),
        ).pipe(handleDbFailure, Effect.flatMap(toDomainHead)),

      // 失効と発行を 1 トランザクションで行う。間で落ちるとクライアントは
      // 手元の券が使えないまま新しい券も受け取れず、再ログインしか道が無くなる
      // (ポートで 2 つに分けなかった理由そのもの)。
      rotate: ({ revoked, issued }) =>
        Effect.tryPromise(() =>
          db.transaction(async (tx) => {
            await tx
              .update(tRefreshToken)
              .set({
                revokedAt: Option.getOrNull(revoked.revokedAt),
                revokedReason: Option.getOrNull(revoked.revokedReason),
              })
              .where(eq(tRefreshToken.id, revoked.id));
            await tx.insert(tRefreshToken).values(toRow(issued));
          }),
        ).pipe(handleDbFailure, Effect.asVoid),

      // **セッションの行すべてを対象にする。** 既に失効している行も含めて理由を
      // revoked へ倒さないと、ローテーション済みで猶予期間内の券が生き残り、
      // 切ったはずのセッションが数十秒使えてしまう (実測で踏んだ穴)。
      //
      // 失効時刻のほうは coalesce で**既にある値を残す**。いつ最初に失効したかは
      // 監査の手掛かりなので上書きしない。判定は理由だけを見るので、時刻は問わない。
      revokeSession: ({ sessionId, revokedAt }) =>
        Effect.tryPromise(() =>
          db
            .update(tRefreshToken)
            .set({
              revokedAt: sql`coalesce(${tRefreshToken.revokedAt}, ${revokedAt})`,
              revokedReason: RevokedReason.Revoked,
            })
            .where(eq(tRefreshToken.sessionId, sessionId)),
        ).pipe(handleDbFailure, Effect.asVoid),
    };
  }),
);
