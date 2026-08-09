import { describe, expect, test } from "bun:test";

import { Effect } from "effect";
import type { Hono } from "hono";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FIXED_UUID, REQUEST_ID, headers } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import {
  ChangePasswordBody,
  CreateUserBody,
  UpdateUserBody,
} from "~/generated/users";
import { UnauthorizedError } from "~/shared/errors/unauthorized-error";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";
import type { RequestIdEnv } from "~/shared/presentation/resolve-request-id";

import { verifyBearer } from "../verify-bearer";

const getUser = async (runtime: AppRuntime, id: string): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, { headers });

/**
 * 契約が `@useAuth(BearerAuth)` を宣言しているエンドポイントで、
 * **実際に Bearer を要求していること**を固定する。
 *
 * ここが壊れると「契約は要認証と言っているのに誰でも通る」状態に戻るが、
 * 応答は 200 系のままなので**気付けない**。実際、auth の実装前はその状態だった。
 */
describe(verifyBearer.name, () => {
  /** Authorization を持たないヘッダ。認証そのものを試すのでこれを使う。 */
  const withoutAuth = {
    "Content-Type": "application/json",
    [HttpHeader.RequestId]: REQUEST_ID,
  };

  /** 認証を要求する 4 本を叩く。ボディは契約を満たす形にしておく。 */
  const requestsNeedingAuth = async (
    app: Hono<RequestIdEnv>,
  ): Promise<readonly Response[]> =>
    await Promise.all([
      app.request(`/users/${FIXED_UUID}`, { headers: withoutAuth }),
      app.request(`/users/${FIXED_UUID}`, {
        method: "PUT",
        headers: withoutAuth,
        body: JSON.stringify({
          name: "新",
          mailAddress: "new@example.com",
        } satisfies typeof UpdateUserBody.Encoded),
      }),
      app.request(`/users/${FIXED_UUID}/password`, {
        method: "PUT",
        headers: withoutAuth,
        body: JSON.stringify({
          currentPassword: "SuperSecret123!",
          newPassword: "BrandNewSecret456!",
        } satisfies typeof ChangePasswordBody.Encoded),
      }),
      app.request(`/users/${FIXED_UUID}`, {
        method: "DELETE",
        headers: withoutAuth,
      }),
    ]);

  describe("正常系", () => {
    test("作成の場合、サインアップ想定なので Bearer 無しでも通ること", async () => {
      const requestBody = {
        name: "新規ユーザー",
        mailAddress: "created@example.com",
        password: "SuperSecret123!",
      } satisfies typeof CreateUserBody.Encoded;

      const app = createApp(makeRuntime());

      const response = await app.request("/users", {
        method: "POST",
        headers: withoutAuth,
        body: JSON.stringify(requestBody),
      });

      expect(response.status).toBe(HttpStatus.Created);
    });
  });

  describe("異常系", () => {
    test("Authorization が無い場合、認証を要求する 4 本すべてが 401 を返すこと", async () => {
      const app = createApp(makeRuntime());

      const responses = await requestsNeedingAuth(app);

      // 本文まで見る。ステータスだけだと、契約検証で先に 400 になっている
      // ケースを 401 と取り違えかねない (どちらも 4xx で通ってしまう)。
      for (const response of responses) {
        expect(response.status).toBe(HttpStatus.Unauthorized);
        expect(await response.json()).toStrictEqual({
          errorCode: ErrorCode.Unauthorized,
          message: ErrorMessage.Unauthorized,
        });
      }
    });

    test("契約も満たさない場合、検証の詳細を返さず 401 にすること", async () => {
      const app = createApp(makeRuntime());

      // 名前は空、メールアドレスも形式違反。**認証を通っていない相手には
      // どのフィールドがなぜ駄目かを教えない** (契約を教えるのと同じになる)。
      const response = await app.request(`/users/${FIXED_UUID}`, {
        method: "PUT",
        headers: withoutAuth,
        body: JSON.stringify({
          name: "",
          mailAddress: "not-a-mail",
        } satisfies typeof UpdateUserBody.Encoded),
      });

      expect(response.status).toBe(HttpStatus.Unauthorized);
      // details が付いていないこと。toStrictEqual なので余計なキーは通らない。
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.Unauthorized,
        message: ErrorMessage.Unauthorized,
      });
    });

    test("署名の検証に失敗した場合、ヘッダが在っても 401 を返すこと", async () => {
      const runtime = makeRuntime({
        accessTokenIssuer: {
          verify: () => Effect.fail(new UnauthorizedError()),
        },
      });

      const response = await getUser(runtime, FIXED_UUID);

      expect(response.status).toBe(HttpStatus.Unauthorized);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.Unauthorized,
        message: ErrorMessage.Unauthorized,
      });
    });
  });
});
