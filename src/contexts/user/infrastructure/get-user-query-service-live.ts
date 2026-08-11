import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";

import { Database } from "~/shared/infrastructure/db/client";
import { handleDbFailure } from "~/shared/infrastructure/db/error/handle-db-failure";

import { GetUserQueryService } from "../application/get-user-query-service";
import { tUser } from "./drizzle-schema";

/**
 * GetUserQueryService の Drizzle 実装 (アダプタ)。
 *
 * SELECT の射影をそのまま DTO の形にしているため、集約への復元も decode も挟まない
 * (ドメインを一切 import しないのが Query 側の実装の特徴)。
 * 必要な列だけを取るので、集約の全列を読む Repository より素直かつ軽い。
 */
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
          .pipe(handleDbFailure)
          .pipe(Effect.map((rows) => Option.fromNullable(rows[0]))),
    };
  }),
);
