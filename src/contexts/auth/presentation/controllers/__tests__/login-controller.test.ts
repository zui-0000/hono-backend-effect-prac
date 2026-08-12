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
import { RefreshToken } from "~/contexts/auth/domain/model/refresh-token";
import { UserId } from "~/contexts/user/domain/model/value-objects/user-id";
import type { LoginBody } from "~/generated/auth";
import type { AccessTokenClaims } from "~/shared/domain/access-token-issuer";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { loginController } from "../login-controller";

/** 集約を「DB に書かれる行の形」に直す。brand が外れるので期待値を素で書ける。 */
const encodeRefreshToken = Schema.encodeSync(RefreshToken);

const login = async (
  runtime: AppRuntime,
  requestBody: typeof LoginBody.Encoded,
): Promise<Response> =>
  await createApp(runtime).request("/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

describe(loginController.name, () => {
  const requestBody = {
    mailAddress: "login@example.com",
    password: "SuperSecret123!",
  } satisfies typeof LoginBody.Encoded;

  /**
   * 照合が通る利用者。auth は user の VerifyCredentialsQueryService 越しにしか見ない。
   *
   * **採番される値 (FIXED_UUID) とは別の id にしてある。** 同じにすると
   * sub (利用者) と sid (セッション) が同値になり、取り違えても気付けない。
   */
  const userId = Schema.decodeSync(UserId)(OTHER_UUID);

  describe("正常系", () => {
    test("照合が通る場合、200 で券の組を返し、保存するのはハッシュだけであること", async () => {
      const created: RefreshToken[] = [];
      const claims: AccessTokenClaims[] = [];
      const runtime = makeRuntime({
        verifyCredentialsQueryService: {
          execute: () => Effect.succeed(Option.some(userId)),
        },
        refreshTokenRepository: {
          create: (token) =>
            Effect.sync(() => {
              created.push(token);
            }),
        },
        accessTokenIssuer: {
          issue: (payload) =>
            Effect.sync(() => {
              claims.push(payload);
              return FAKE_ACCESS_TOKEN;
            }),
        },
      });

      const response = await login(runtime, requestBody);

      expect(response.status).toBe(HttpStatus.Ok);
      expect(await response.json()).toStrictEqual({
        accessToken: FAKE_ACCESS_TOKEN,
        refreshToken: FAKE_REFRESH_TOKEN,
      });

      // **集約を丸ごと突き合わせる。** 平文の券が紛れ込んでいないことを
      // 「特定の項目だけ見る」形で確かめると、項目が増えたときに漏れる。
      // 保存されるのは hash で、クライアントへ返す token は残らない。
      // encode してから比べているのは、**DB に書かれる行の形で見るため**。
      expect(created.map((token) => encodeRefreshToken(token))).toStrictEqual([
        {
          id: FIXED_UUID,
          sessionId: FIXED_UUID,
          tokenHash: FAKE_TOKEN_HASH,
          userId: OTHER_UUID,
          expiresAt: expect.any(Date),
          revokedAt: null,
          revokedReason: null,
          createdAt: expect.any(Date),
        },
      ]);

      // アクセストークンの sub は利用者、sid は今回のセッション。
      // sid を載せ忘れるとログアウトが誰のどのセッションか分からなくなる。
      expect(claims).toStrictEqual([{ sub: userId, sid: FIXED_UUID }]);
    });
  });

  describe("異常系", () => {
    test("照合に失敗した場合、401 を返し、券も発行しないこと", async () => {
      const created: RefreshToken[] = [];
      // 既定の fake は Option.none = 照合できない。**「居ない」と「合わない」は
      // user 側で既に畳まれている**ので、ここからは区別のしようがない
      // (区別できない形にしてあること自体が、アカウント列挙を防ぐ設計)。
      const runtime = makeRuntime({
        refreshTokenRepository: {
          create: (token) =>
            Effect.sync(() => {
              created.push(token);
            }),
        },
      });

      const response = await login(runtime, requestBody);

      expect(response.status).toBe(HttpStatus.Unauthorized);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.Unauthorized,
        message: ErrorMessage.Unauthorized,
      });
      expect(created).toStrictEqual([]);
    });

    test("契約に反するパスワードの場合、400 と該当フィールドを返すこと", async () => {
      const runtime = makeRuntime({
        verifyCredentialsQueryService: {
          execute: () => Effect.succeed(Option.some(userId)),
        },
      });

      // 長さの検証は契約スキーマの仕事。command は照合を user に委ねるだけで、
      // メールアドレスの形式もパスワードの長さも判断しない。
      const response = await login(runtime, {
        ...requestBody,
        password: "short",
      });

      expect(response.status).toBe(HttpStatus.BadRequest);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.BadRequest,
        message: ErrorMessage.BadRequest,
        details: [{ field: "password", message: expect.any(String) }],
      });
    });
  });
});
