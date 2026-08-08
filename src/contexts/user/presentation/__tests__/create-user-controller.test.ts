import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import {
  FAKE_HASH,
  makeUser,
  REQUEST_ID,
  FIXED_UUID,
  headers,
  validBody,
} from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { User } from "~/contexts/user/domain/model/user";
import type { UserHashedPassword } from "~/contexts/user/domain/model/value-objects/user-hashed-password";
import type { UserId } from "~/contexts/user/domain/model/value-objects/user-id";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";
const postUsers = async (
  runtime: AppRuntime,
  body: Record<string, unknown>,
): Promise<Response> =>
  await createApp(runtime).request("/users", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

describe("POST /users", () => {
  test("正常系: 201 を返し、ハッシュ済みの User を永続化する", async () => {
    const created: User[] = [];
    const runtime = makeRuntime({
      userRepository: {
        create: (user) =>
          Effect.sync(() => {
            created.push(user);
          }),
      },
    });

    const response = await postUsers(runtime, validBody);

    expect(response.status).toBe(HttpStatus.Created);
    expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    // 採番された id だけを返す (クライアントが GET /users/{id} を呼べるように)。
    expect(await response.json()).toEqual({ id: FIXED_UUID });
    expect(created).toHaveLength(1);
    // 採番は UuidGenerator 経由なので、テストでは固定値になる。
    expect(created[0]?.id).toBe(FIXED_UUID as UserId);
    // ドメインは平文を持たず、PasswordHasher の結果だけを保持する。
    expect(created[0]?.hashedPassword).toBe(FAKE_HASH as UserHashedPassword);
  });

  test("異常系: メールアドレス重複は 409 (errorCode 4091)", async () => {
    const existing = makeUser({ mailAddress: validBody.mailAddress });
    const runtime = makeRuntime({
      userRepository: {
        findByMailAddress: () => Effect.succeed(Option.some(existing)),
      },
    });

    const response = await postUsers(runtime, validBody);

    expect(response.status).toBe(HttpStatus.Conflict);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.MailAddressAlreadyExists,
    });
  });

  test("異常系: 契約に反するリクエストは 400 と該当フィールド", async () => {
    const response = await postUsers(makeRuntime(), {
      ...validBody,
      password: "short",
    });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "password" }],
    });
  });
});
