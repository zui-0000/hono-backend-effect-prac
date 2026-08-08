import { describe, expect, test } from "bun:test";

import { Effect, Option, Schema } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import {
  FAKE_ACCESS_TOKEN,
  FAKE_REFRESH_TOKEN,
  FAKE_TOKEN_HASH,
  FIXED_UUID,
  headers,
  OTHER_UUID,
} from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import {
  RefreshToken,
  RevokedReason,
} from "~/contexts/auth/domain/model/refresh-token";
import type { RefreshTokenHash } from "~/contexts/auth/domain/model/value-objects/refresh-token-hash";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

/** 差し替え後の券。提示した券と区別できるよう、既定の fake とは別の値にする。 */
const NEXT_REFRESH_TOKEN = "rt_next-refresh-token-after-rotation-0123456789";
const NEXT_TOKEN_HASH =
  "1111111111111111111111111111111111111111111111111111111111111111";

const refresh = async (
  runtime: AppRuntime,
  body: Record<string, unknown> = { refreshToken: FAKE_REFRESH_TOKEN },
): Promise<Response> =>
  await createApp(runtime).request("/auth/refresh", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

/**
 * 保存済みの券を組み立てる。
 *
 * **状態の判定そのものは単体テストが持っている**
 * ([`refresh-token.test.ts`](../../domain/model/__tests__/refresh-token.test.ts))。
 * ここで確かめるのは、判定の結果が HTTP の応答と副作用に正しく繋がっているか。
 */
const makeStored = (
  over: {
    readonly expiresAt?: Date;
    readonly revokedAt?: Date | null;
    readonly revokedReason?: RevokedReason | null;
  } = {},
): RefreshToken =>
  Schema.decodeUnknownSync(RefreshToken)({
    id: "019fde14-54da-7000-85b3-d7e794ca99f6",
    sessionId: OTHER_UUID,
    tokenHash: FAKE_TOKEN_HASH,
    userId: FIXED_UUID,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    revokedReason: null,
    createdAt: new Date(),
    ...over,
  });

/** 提示された券が引き当たり、差し替え先が新しい値になるランタイム。 */
const runtimeWith = (
  stored: RefreshToken,
  record: {
    readonly rotated?: { revoked: RefreshToken; issued: RefreshToken }[];
    readonly revoked?: { sessionId: string; revokedAt: Date }[];
  } = {},
): AppRuntime =>
  makeRuntime({
    refreshTokenRepository: {
      findByTokenHash: () => Effect.succeed(Option.some(stored)),
      rotate: (params) =>
        Effect.sync(() => {
          record.rotated?.push(params);
        }),
      revokeSession: (params) =>
        Effect.sync(() => {
          record.revoked?.push(params);
        }),
    },
    refreshTokenIssuer: {
      issue: Effect.succeed({
        token: NEXT_REFRESH_TOKEN,
        hash: NEXT_TOKEN_HASH,
      }),
    },
  });

describe("POST /auth/refresh", () => {
  test("正常系: 200 で新しい組を返し、失効と発行を 1 つの単位で渡す", async () => {
    const stored = makeStored();
    const rotated: { revoked: RefreshToken; issued: RefreshToken }[] = [];

    const response = await refresh(runtimeWith(stored, { rotated }));

    expect(response.status).toBe(HttpStatus.Ok);
    expect(await response.json()).toEqual({
      accessToken: FAKE_ACCESS_TOKEN,
      // 返るのは**差し替え後**の券。提示した券をそのまま返すと、
      // クライアントは失効済みの券を持ち続けることになる。
      refreshToken: NEXT_REFRESH_TOKEN,
    });

    expect(rotated).toHaveLength(1);
    // 失効の理由は rotated。ここを revoked にすると猶予期間が効かず、
    // 並行更新した 2 つ目のタブが盗難扱いされる。
    expect(rotated[0]?.revoked.revokedReason).toEqual(
      Option.some(RevokedReason.Rotated),
    );
    expect(rotated[0]?.issued.tokenHash).toBe(
      NEXT_TOKEN_HASH as RefreshTokenHash,
    );
    // **セッションは据え置く。** 採番し直すと更新のたびにログアウトの単位が変わり、
    // 古いタブからのログアウトが効かなくなる。
    expect(rotated[0]?.issued.sessionId).toBe(stored.sessionId);
    expect(rotated[0]?.issued.userId).toBe(stored.userId);
  });

  test("正常系: 猶予期間の内なら、ローテーション済みの券でも通す", async () => {
    const stored = makeStored({
      revokedAt: new Date(Date.now() - 5_000),
      revokedReason: RevokedReason.Rotated,
    });
    const rotated: { revoked: RefreshToken; issued: RefreshToken }[] = [];

    const response = await refresh(runtimeWith(stored, { rotated }));

    // 締め出さないことがここでの正解。並行更新は正規の利用者の姿。
    expect(response.status).toBe(HttpStatus.Ok);
    expect(rotated).toHaveLength(1);
  });

  test("異常系: 猶予期間の外の再利用は 401 で、セッションごと切る", async () => {
    const stored = makeStored({
      revokedAt: new Date(Date.now() - 60_000),
      revokedReason: RevokedReason.Rotated,
    });
    const rotated: { revoked: RefreshToken; issued: RefreshToken }[] = [];
    const revoked: { sessionId: string; revokedAt: Date }[] = [];

    const response = await refresh(runtimeWith(stored, { rotated, revoked }));

    expect(response.status).toBe(HttpStatus.Unauthorized);
    // 盗難のサイン。**差し替えずに**セッションを落とす。
    expect(rotated).toEqual([]);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]?.sessionId).toBe(stored.sessionId);
  });

  test("異常系: 既に切られた券は 401 で、切り直しもしない", async () => {
    const stored = makeStored({
      revokedAt: new Date(Date.now() - 5_000),
      revokedReason: RevokedReason.Revoked,
    });
    const rotated: { revoked: RefreshToken; issued: RefreshToken }[] = [];
    const revoked: { sessionId: string; revokedAt: Date }[] = [];

    const response = await refresh(runtimeWith(stored, { rotated, revoked }));

    expect(response.status).toBe(HttpStatus.Unauthorized);
    // ログアウト / 盗難検出で切った側なので、盗難ではない。追加の防御は要らない。
    // 猶予期間の内 (5 秒前) でも通してはいけない — 通すとセッションが生き返る。
    expect(rotated).toEqual([]);
    expect(revoked).toEqual([]);
  });

  test("異常系: 知らない券は 401", async () => {
    // 既定の fake は findByTokenHash が Option.none を返す。
    const response = await refresh(makeRuntime());

    expect(response.status).toBe(HttpStatus.Unauthorized);
  });

  test("異常系: 401 の本文は理由を書き分けない", async () => {
    const bodies = await Promise.all(
      [
        makeRuntime(), // 知らない券
        runtimeWith(makeStored({ expiresAt: new Date(Date.now() - 1_000) })), // 期限切れ
        runtimeWith(
          makeStored({
            revokedAt: new Date(Date.now() - 5_000),
            revokedReason: RevokedReason.Revoked,
          }),
        ), // 失効済み
      ].map(async (runtime) => await (await refresh(runtime)).json()),
    );

    // 書き分けると「その券は存在する」「期限だけの問題だ」と攻撃側に教えることになる。
    // command の失敗を UnauthorizedError の 1 種類に畳んであるのはこのため。
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
    expect(bodies[0]).toMatchObject({ errorCode: ErrorCode.Unauthorized });
  });

  test("異常系: 契約に反する券は 400 と該当フィールド", async () => {
    // 不透明トークンなので中身は検証できない。契約が見るのは長さだけ。
    const response = await refresh(makeRuntime(), { refreshToken: "short" });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "refreshToken" }],
    });
  });
});
