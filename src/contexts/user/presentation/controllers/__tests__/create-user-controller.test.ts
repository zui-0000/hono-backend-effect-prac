import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FAKE_HASH, FIXED_UUID, headers, makeUser } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { User } from "~/contexts/user/domain/model/user";
import type { UserHashedPassword } from "~/contexts/user/domain/model/value-objects/user-hashed-password";
import type { UserId } from "~/contexts/user/domain/model/value-objects/user-id";
import { CreateUserBody } from "~/generated/users";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { createUserController } from "../create-user-controller";

const postUsers = async (
  runtime: AppRuntime,
  requestBody: typeof CreateUserBody.Encoded,
): Promise<Response> =>
  await createApp(runtime).request("/users", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

describe(createUserController.name, () => {
  const requestBody = {
    name: "新規ユーザー",
    mailAddress: "created@example.com",
    password: "SuperSecret123!",
  } satisfies typeof CreateUserBody.Encoded;

  describe("正常系", () => {
    test("契約を満たすリクエストの場合、201 を返し、ハッシュ済みの User を永続化すること", async () => {
      const created: User[] = [];
      const runtime = makeRuntime({
        userRepository: {
          create: (user) =>
            Effect.sync(() => {
              created.push(user);
            }),
        },
      });

      const response = await postUsers(runtime, requestBody);

      expect(response.status).toBe(HttpStatus.Created);
      // 採番された id だけを返す (クライアントが GET /users/{id} を呼べるように)。
      expect(await response.json()).toStrictEqual({ id: FIXED_UUID });
      expect(created).toHaveLength(1);
      // 採番は UuidGenerator 経由なので、テストでは固定値になる。
      expect(created[0]?.id).toBe(FIXED_UUID as UserId);
      // ドメインは平文を持たず、PasswordHasher の結果だけを保持する。
      expect(created[0]?.hashedPassword).toBe(FAKE_HASH as UserHashedPassword);
    });
  });

  describe("異常系", () => {
    test("メールアドレスが重複する場合、409 を返し、永続化も走らないこと", async () => {
      const created: User[] = [];
      const existing = makeUser({ mailAddress: requestBody.mailAddress });
      const runtime = makeRuntime({
        userRepository: {
          findByMailAddress: () => Effect.succeed(Option.some(existing)),
          create: (user) =>
            Effect.sync(() => {
              created.push(user);
            }),
        },
      });

      const response = await postUsers(runtime, requestBody);

      expect(response.status).toBe(HttpStatus.Conflict);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.MailAddressDuplication,
        message: ErrorMessage.MailAddressDuplication,
      });
      // 409 を返しつつ書き込みも走っていた、が起こりうる。応答だけでは見えない。
      expect(created).toStrictEqual([]);
    });

    test("契約に反するリクエストの場合、400 と該当フィールドを返すこと", async () => {
      const runtime = makeRuntime();

      const response = await postUsers(runtime, {
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
