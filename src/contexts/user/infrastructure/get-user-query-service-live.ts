import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";

import { Database } from "~/shared/infrastructure/db/database-client";
import { handleDbError } from "~/shared/infrastructure/db/error/handle-db-error";

import { GetUserQueryService } from "../application/get-user-query-service";
import { tUser } from "./drizzle-schema";

/**
 * GetUserQueryService の Drizzle 実装 (アダプタ)。
 *
 * SELECT の射影をそのまま DTO の形にしているため、集約への復元も decode も挟まない
 * (ドメインを一切 import しないのが Query 側の実装の特徴)。
 * 必要な列だけを取るので、集約の全列を読む Repository より素直かつ軽い。
 */
/**
 * 検索結果の先頭行を取り出す (0 件なら Option.none)。
 *
 * リポジトリ側の `restoreUser` と違い**集約への復元をしない**。射影をそのまま DTO として
 * 返す経路で decode を挟む相手がおらず、`restore` と名乗ると嘘になるため動詞を分けてある。
 */
const takeFirstRow = <A, E, R>(
  effect: Effect.Effect<readonly A[], E, R>,
): Effect.Effect<Option.Option<A>, E, R> =>
  effect.pipe(Effect.map((rows) => Option.fromNullable(rows[0])));

export const GetUserQueryServiceLive = Layer.effect(
  GetUserQueryService,
  Effect.gen(function* () {
    const db = yield* Database;

    return {
      execute: ({ id }) =>
        Effect.tryPromise(() =>
          db
            .select({ name: tUser.name, mailAddress: tUser.mailAddress })
            .from(tUser)
            .where(eq(tUser.id, id))
            .limit(1),
        )
          .pipe(handleDbError)
          .pipe(takeFirstRow),
    };
  }),
);
