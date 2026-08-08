import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FAKE_CLAIMS, headers, REQUEST_ID } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

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

describe("POST /auth/logout", () => {
  test("正常系: 204 を返し、Bearer の sid でセッションを切る", async () => {
    const revoked: Revoked[] = [];
    const runtime = makeRuntime({
      refreshTokenRepository: {
        revokeSession: (params) =>
          Effect.sync(() => {
            revoked.push(params);
          }),
      },
    });

    const response = await logout(runtime);

    expect(response.status).toBe(HttpStatus.NoContent);
    expect(await response.text()).toBe("");
    expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);

    expect(revoked).toHaveLength(1);
    // **切る単位はセッション (sid) であって利用者 (sub) ではない。**
    // sub で切ると、スマホでログアウトしたら PC まで落ちる。
    expect(revoked[0]?.sessionId).toBe(FAKE_CLAIMS.sid);
    expect(revoked[0]?.sessionId).not.toBe(FAKE_CLAIMS.sub);
    // 失効時刻は Clock から取ってドメイン側で決める (DB の now() に任せない)。
    expect(revoked[0]?.revokedAt).toBeInstanceOf(Date);
  });

  test("正常系: 該当するセッションが無くても 204 (冪等)", async () => {
    // 既定の fake は「何も無くても成功」。二重送信やリトライで 404 を返さないよう、
    // 存在を確かめずに失効させている。契約も 204 だけを宣言している。
    const response = await logout(makeRuntime());

    expect(response.status).toBe(HttpStatus.NoContent);
    expect(await response.text()).toBe("");
  });

  test("異常系: Bearer が無ければ 401 で、失効も走らない", async () => {
    const revoked: Revoked[] = [];
    const runtime = makeRuntime({
      refreshTokenRepository: {
        revokeSession: (params) =>
          Effect.sync(() => {
            revoked.push(params);
          }),
      },
    });

    // 入力が claims だけのエンドポイントなので、**Bearer を素通しすると
    // どのセッションを切るかが決まらない**。認証が要ることを固定しておく。
    const response = await logout(runtime, {
      "Content-Type": "application/json",
      [HttpHeader.RequestId]: REQUEST_ID,
    });

    expect(response.status).toBe(HttpStatus.Unauthorized);
    expect(revoked).toEqual([]);
  });
});
