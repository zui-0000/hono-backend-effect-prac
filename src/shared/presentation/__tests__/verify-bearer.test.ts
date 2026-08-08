import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FIXED_UUID, REQUEST_ID, headers, validBody } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { UnauthorizedError } from "~/shared/errors/unauthorized-error";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";
const getUser = async (runtime: AppRuntime, id: string): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, { headers });

describe("認証 (Bearer)", () => {
  /**
   * 契約が `@useAuth(BearerAuth)` を宣言しているエンドポイントで、
   * **実際に Bearer を要求していること**を固定する。
   *
   * ここが壊れると「契約は要認証と言っているのに誰でも通る」状態に戻るが、
   * 応答は 200 系のままなので**気付けない**。実際、auth の実装前はその状態だった。
   */
  const withoutAuth = {
    "Content-Type": "application/json",
    [HttpHeader.RequestId]: REQUEST_ID,
  };

  test("Authorization が無ければ 401 (認証を要求する 4 本すべて)", async () => {
    const runtime = makeRuntime();
    const app = createApp(runtime);
    const id = FIXED_UUID;

    const responses = await Promise.all([
      app.request(`/users/${id}`, { headers: withoutAuth }),
      app.request(`/users/${id}`, {
        method: "PUT",
        headers: withoutAuth,
        body: JSON.stringify({ name: "新", mailAddress: "new@example.com" }),
      }),
      app.request(`/users/${id}/password`, {
        method: "PUT",
        headers: withoutAuth,
        body: JSON.stringify({
          currentPassword: "SuperSecret123!",
          newPassword: "BrandNewSecret456!",
        }),
      }),
      app.request(`/users/${id}`, { method: "DELETE", headers: withoutAuth }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(HttpStatus.Unauthorized);
    }
  });

  test("作成は認証不要 (サインアップ想定なので Bearer 無しで通る)", async () => {
    const runtime = makeRuntime();

    const response = await createApp(runtime).request("/users", {
      method: "POST",
      headers: withoutAuth,
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(HttpStatus.Created);
  });

  test("署名の検証に失敗すれば 401 (ヘッダが在っても通さない)", async () => {
    const runtime = makeRuntime({
      accessTokenIssuer: { verify: () => Effect.fail(new UnauthorizedError()) },
    });

    const response = await getUser(runtime, FIXED_UUID);

    expect(response.status).toBe(HttpStatus.Unauthorized);
    expect(await response.json()).toEqual({
      errorCode: ErrorCode.Unauthorized,
      message: expect.any(String),
    });
  });
});
