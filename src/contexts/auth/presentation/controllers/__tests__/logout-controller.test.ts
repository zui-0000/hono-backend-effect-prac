import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FAKE_CLAIMS, headers, REQUEST_ID } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { logoutController } from "../logout-controller";

const logout = async (
  runtime: AppRuntime,
  requestHeaders: Record<string, string> = headers,
): Promise<Response> =>
  await createApp(runtime).request("/auth/logout", {
    method: "POST",
    headers: requestHeaders,
  });

/** revokeSession に渡された引数。切る単位を取り違えていないか確かめるために記録する。 */
type Revoked = { readonly sessionId: string; readonly revokedAt: Date };

/** 失効の呼び出しを記録するランタイム。 */
const recording = (): {
  readonly runtime: AppRuntime;
  readonly revoked: Revoked[];
} => {
  const revoked: Revoked[] = [];
  return {
    revoked,
    runtime: makeRuntime({
      refreshTokenRepository: {
        revokeSession: (params) =>
          Effect.sync(() => {
            revoked.push(params);
          }),
      },
    }),
  };
};

describe(logoutController.name, () => {
  describe("正常系", () => {
    test("Bearer が有効な場合、204 を返し、その sid でセッションを切ること", async () => {
      const { runtime, revoked } = recording();

      const response = await logout(runtime);

      expect(response.status).toBe(HttpStatus.NoContent);
      expect(await response.text()).toBe("");

      // **切る単位はセッション (sid) であって利用者 (sub) ではない。**
      // sub で切ると、スマホでログアウトしたら PC まで落ちる。
      // 失効時刻は Clock から取る (DB の now() に任せない)。
      expect(revoked).toStrictEqual([
        { sessionId: FAKE_CLAIMS.sid, revokedAt: expect.any(Date) },
      ]);
      expect(revoked[0]?.sessionId).not.toBe(FAKE_CLAIMS.sub);
    });
  });

  describe("異常系", () => {
    test("Bearer が無い場合、401 を返し、失効も走らないこと", async () => {
      const { runtime, revoked } = recording();

      // 入力が claims だけのエンドポイントなので、**Bearer を素通しすると
      // どのセッションを切るかが決まらない**。認証が要ることを固定しておく。
      const response = await logout(runtime, {
        "Content-Type": "application/json",
        [HttpHeader.RequestId]: REQUEST_ID,
      });

      expect(response.status).toBe(HttpStatus.Unauthorized);
      expect(revoked).toStrictEqual([]);
    });
  });
});
