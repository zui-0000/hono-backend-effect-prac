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
import type { RefreshBody } from "~/generated/auth";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { refreshController } from "../refresh-controller";

/** 差し替え後の券。提示した券と区別できるよう、既定の fake とは別の値にする。 */
const NEXT_REFRESH_TOKEN = "rt_next-refresh-token-after-rotation-0123456789";
const NEXT_TOKEN_HASH =
  "1111111111111111111111111111111111111111111111111111111111111111";

const refresh = async (
  runtime: AppRuntime,
  requestBody: typeof RefreshBody.Encoded = {
    refreshToken: FAKE_REFRESH_TOKEN,
  },
): Promise<Response> =>
  await createApp(runtime).request("/auth/refresh", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

/**
 * 保存済みの券を組み立てる。
 *
 * **状態の判定そのものは単体テストが持っている**
 * ([`refresh-token.test.ts`](../../../domain/model/__tests__/refresh-token.test.ts))。
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

type Rotated = {
  readonly revoked: RefreshToken;
  readonly issued: RefreshToken;
};
type Revoked = { readonly sessionId: string; readonly revokedAt: Date };

/**
 * 提示された券が引き当たる状況を作り、リポジトリへの呼び出しを記録する。
 * `stored` を省くと「知らない券」になる。
 */
const recording = (
  stored?: RefreshToken,
): {
  readonly runtime: AppRuntime;
  readonly rotated: Rotated[];
  readonly revoked: Revoked[];
} => {
  const rotated: Rotated[] = [];
  const revoked: Revoked[] = [];
  return {
    rotated,
    revoked,
    runtime: makeRuntime({
      refreshTokenRepository: {
        findByTokenHash: () => Effect.succeed(Option.fromNullable(stored)),
        rotate: (params) =>
          Effect.sync(() => {
            rotated.push(params);
          }),
        revokeSession: (params) =>
          Effect.sync(() => {
            revoked.push(params);
          }),
      },
      refreshTokenIssuer: {
        issue: Effect.succeed({
          token: NEXT_REFRESH_TOKEN,
          hash: NEXT_TOKEN_HASH,
        }),
      },
    }),
  };
};

describe(refreshController.name, () => {
  describe("正常系", () => {
    test("使える券の場合、200 で新しい組を返し、失効と発行を 1 つの単位で渡すこと", async () => {
      const stored = makeStored();
      const { runtime, rotated } = recording(stored);

      const response = await refresh(runtime);

      expect(response.status).toBe(HttpStatus.Ok);
      expect(await response.json()).toStrictEqual({
        accessToken: FAKE_ACCESS_TOKEN,
        // 返るのは**差し替え後**の券。提示した券をそのまま返すと、
        // クライアントは失効済みの券を持ち続けることになる。
        refreshToken: NEXT_REFRESH_TOKEN,
      });

      expect(rotated).toHaveLength(1);
      // 失効させるのは**いま提示された券そのもの**。
      expect(rotated[0]?.revoked.id).toBe(stored.id);
      // 理由は rotated。ここを revoked にすると猶予期間が効かず、
      // 並行更新した 2 つ目のタブが盗難扱いされる。
      expect(rotated[0]?.revoked.revokedReason).toStrictEqual(
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

    test("ローテーション済みでも猶予期間の内の場合、締め出さずに通すこと", async () => {
      const { runtime, rotated } = recording(
        makeStored({
          revokedAt: new Date(Date.now() - 5_000),
          revokedReason: RevokedReason.Rotated,
        }),
      );

      const response = await refresh(runtime);

      // 締め出さないことがここでの正解。並行更新は正規の利用者の姿。
      expect(response.status).toBe(HttpStatus.Ok);
      expect(await response.json()).toStrictEqual({
        accessToken: FAKE_ACCESS_TOKEN,
        refreshToken: NEXT_REFRESH_TOKEN,
      });
      expect(rotated).toHaveLength(1);
    });
  });

  describe("異常系", () => {
    test("猶予期間の外で再利用された場合、401 を返し、セッションごと切ること", async () => {
      const stored = makeStored({
        revokedAt: new Date(Date.now() - 60_000),
        revokedReason: RevokedReason.Rotated,
      });
      const { runtime, rotated, revoked } = recording(stored);

      const response = await refresh(runtime);

      expect(response.status).toBe(HttpStatus.Unauthorized);
      // 盗難のサイン。**差し替えずに**セッションを落とす。
      expect(rotated).toStrictEqual([]);
      expect(revoked).toStrictEqual([
        { sessionId: stored.sessionId, revokedAt: expect.any(Date) },
      ]);
    });

    test("既に切られた券の場合、401 を返し、切り直しもしないこと", async () => {
      const { runtime, rotated, revoked } = recording(
        makeStored({
          revokedAt: new Date(Date.now() - 5_000),
          revokedReason: RevokedReason.Revoked,
        }),
      );

      const response = await refresh(runtime);

      expect(response.status).toBe(HttpStatus.Unauthorized);
      // ログアウト / 盗難検出で切った側なので、盗難ではない。追加の防御は要らない。
      // 猶予期間の内 (5 秒前) でも通してはいけない — 通すとセッションが生き返る。
      expect(rotated).toStrictEqual([]);
      expect(revoked).toStrictEqual([]);
    });

    test("期限切れの券の場合、401 を返し、差し替えも失効も走らないこと", async () => {
      const { runtime, rotated, revoked } = recording(
        makeStored({ expiresAt: new Date(Date.now() - 1_000) }),
      );

      const response = await refresh(runtime);

      expect(response.status).toBe(HttpStatus.Unauthorized);
      // 再ログインしてもらうしかない。盗難ではないのでセッションは切らない。
      expect(rotated).toStrictEqual([]);
      expect(revoked).toStrictEqual([]);
    });

    test("知らない券の場合、401 を返し、差し替えも失効も走らないこと", async () => {
      const { runtime, rotated, revoked } = recording();

      const response = await refresh(runtime);

      expect(response.status).toBe(HttpStatus.Unauthorized);
      expect(rotated).toStrictEqual([]);
      expect(revoked).toStrictEqual([]);
    });

    test("401 になる理由が違う場合、本文を書き分けないこと", async () => {
      const unknown = recording().runtime;
      const expired = recording(
        makeStored({ expiresAt: new Date(Date.now() - 1_000) }),
      ).runtime;
      const alreadyRevoked = recording(
        makeStored({
          revokedAt: new Date(Date.now() - 5_000),
          revokedReason: RevokedReason.Revoked,
        }),
      ).runtime;

      const bodies = await Promise.all(
        [unknown, expired, alreadyRevoked].map(
          async (runtime) => await (await refresh(runtime)).json(),
        ),
      );

      // 書き分けると「その券は存在する」「期限だけの問題だ」と攻撃側に教えることになる。
      // command の失敗を UnauthorizedError の 1 種類に畳んであるのはこのため。
      expect(bodies[0]).toStrictEqual(bodies[1]);
      expect(bodies[1]).toStrictEqual(bodies[2]);
      expect(bodies[0]).toStrictEqual({
        errorCode: ErrorCode.Unauthorized,
        message: ErrorMessage.Unauthorized,
      });
    });

    test("契約に反する券の場合、400 と該当フィールドを返すこと", async () => {
      // 不透明トークンなので中身は検証できない。契約が見るのは長さだけ。
      const runtime = makeRuntime();

      const response = await refresh(runtime, { refreshToken: "short" });

      expect(response.status).toBe(HttpStatus.BadRequest);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.BadRequest,
        message: ErrorMessage.BadRequest,
        details: [{ field: "refreshToken", message: expect.any(String) }],
      });
    });
  });
});
