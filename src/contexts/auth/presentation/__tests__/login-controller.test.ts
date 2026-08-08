import { describe, expect, test } from "bun:test";

import { Effect, Option, Schema } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import {
  FAKE_ACCESS_TOKEN,
  FAKE_REFRESH_TOKEN,
  FAKE_TOKEN_HASH,
  FIXED_UUID,
  headers,
} from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import type { RefreshToken } from "~/contexts/auth/domain/model/refresh-token";
import type { RefreshTokenHash } from "~/contexts/auth/domain/model/value-objects/refresh-token-hash";
import { UserId } from "~/contexts/user/domain/model/value-objects/user-id";
import type { AccessTokenClaims } from "~/shared/domain/access-token-issuer";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

const login = async (
  runtime: AppRuntime,
  body: Record<string, unknown>,
): Promise<Response> =>
  await createApp(runtime).request("/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

describe("POST /auth/login", () => {
  const credentials = {
    mailAddress: "asuka@example.com",
    password: "SuperSecret123!",
  };

  /** 照合が通る利用者。auth は user の VerifyCredentialsQueryService 越しにしか見ない。 */
  const userId = Schema.decodeSync(UserId)(FIXED_UUID);

  test("正常系: 200 で券の組を返し、保存するのはハッシュだけ", async () => {
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

    const response = await login(runtime, credentials);

    expect(response.status).toBe(HttpStatus.Ok);
    expect(await response.json()).toEqual({
      accessToken: FAKE_ACCESS_TOKEN,
      refreshToken: FAKE_REFRESH_TOKEN,
    });

    expect(created).toHaveLength(1);
    // **平文の券はサーバに残らない。** 返すのは token、保存するのは hash という
    // 組み分けを守れているかは、集約を丸ごと文字列にして確かめるのが確実。
    expect(created[0]?.tokenHash).toBe(FAKE_TOKEN_HASH as RefreshTokenHash);
    expect(JSON.stringify(created[0])).not.toContain(FAKE_REFRESH_TOKEN);
    expect(Option.isNone(created[0]!.revokedAt)).toBe(true);

    // アクセストークンの sub は利用者、sid は今回のセッション。
    // sid を載せ忘れるとログアウトが誰のどのセッションか分からなくなる。
    expect(claims).toEqual([{ sub: userId, sid: created[0]!.sessionId }]);
  });

  test("異常系: 照合に失敗すれば 401 で、券も発行されない", async () => {
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

    const response = await login(runtime, credentials);

    expect(response.status).toBe(HttpStatus.Unauthorized);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.Unauthorized,
    });
    expect(created).toEqual([]);
  });

  test("異常系: 契約に反するパスワードは 400 と該当フィールド", async () => {
    const runtime = makeRuntime({
      verifyCredentialsQueryService: {
        execute: () => Effect.succeed(Option.some(userId)),
      },
    });

    // 長さの検証は契約スキーマの仕事。command は照合を user に委ねるだけで、
    // メールアドレスの形式もパスワードの長さも判断しない。
    const response = await login(runtime, {
      ...credentials,
      password: "short",
    });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "password" }],
    });
  });
});
