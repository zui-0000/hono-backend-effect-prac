import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import {
  EXISTING_HASH,
  FAKE_HASH,
  FIXED_UUID,
  headers,
  makeUser,
  OTHER_UUID,
} from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { User } from "~/contexts/user/domain/model/user";
import type { UserHashedPassword } from "~/contexts/user/domain/model/value-objects/user-hashed-password";
import { ChangePasswordBody } from "~/generated/users";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { changePasswordController } from "../change-password-controller";

const putPassword = async (
  runtime: AppRuntime,
  id: string,
  requestBody: typeof ChangePasswordBody.Encoded,
): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}/password`, {
    method: "PUT",
    headers,
    body: JSON.stringify(requestBody),
  });

describe(changePasswordController.name, () => {
  const requestBody = {
    currentPassword: "SuperSecret123!",
    newPassword: "BrandNewSecret456!",
  } satisfies typeof ChangePasswordBody.Encoded;

  describe("正常系", () => {
    test("現在のパスワードが合っている場合、204 を返し、新しいハッシュだけを差し替えて永続化すること", async () => {
      const existing = makeUser();
      const updated: User[] = [];
      // 照合に渡された値。新旧を取り違えていないことを確かめるために記録する。
      const verified: [string, string][] = [];
      const runtime = makeRuntime({
        userRepository: {
          findById: () => Effect.succeed(Option.some(existing)),
          updatePassword: (user) =>
            Effect.sync(() => {
              updated.push(user);
            }),
        },
        passwordHasher: {
          verify: (plainText, hashed) =>
            Effect.sync(() => {
              verified.push([plainText, hashed]);
              return true;
            }),
        },
      });

      const response = await putPassword(runtime, FIXED_UUID, requestBody);

      expect(response.status).toBe(HttpStatus.NoContent);
      expect(await response.text()).toBe("");

      // 照合するのは「現在のパスワード」と「保存済みのハッシュ」。
      expect(verified).toStrictEqual([
        [requestBody.currentPassword, EXISTING_HASH],
      ]);

      expect(updated).toHaveLength(1);
      // 保存されるのは新しい平文のハッシュ (平文そのものは決して入らない)。
      expect(updated[0]?.hashedPassword).toBe(FAKE_HASH as UserHashedPassword);
      // パスワード以外は据え置き。
      expect(updated[0]?.id).toBe(existing.id);
      expect(updated[0]?.name).toBe(existing.name);
      expect(updated[0]?.mailAddress).toBe(existing.mailAddress);
      expect(updated[0]?.createdAt).toStrictEqual(existing.createdAt);
      // updatedAt だけが進む。
      expect(updated[0]?.updatedAt.getTime()).toBeGreaterThan(
        existing.updatedAt.getTime(),
      );
      // 元の集約は書き換わらない (イミュータブル)。
      expect(existing.hashedPassword).toBe(EXISTING_HASH as UserHashedPassword);
    });
  });

  describe("異常系", () => {
    test("現在のパスワードが違う場合、401 を返し、永続化も走らないこと", async () => {
      const updated: User[] = [];
      const runtime = makeRuntime({
        userRepository: {
          findById: () => Effect.succeed(Option.some(makeUser())),
          updatePassword: (user) =>
            Effect.sync(() => {
              updated.push(user);
            }),
        },
        passwordHasher: { verify: () => Effect.succeed(false) },
      });

      const response = await putPassword(runtime, FIXED_UUID, requestBody);

      expect(response.status).toBe(HttpStatus.Unauthorized);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.Unauthorized,
        message: ErrorMessage.Unauthorized,
      });
      expect(updated).toStrictEqual([]);
    });

    test("存在しない id の場合、404 を返し、永続化も走らないこと", async () => {
      const updated: User[] = [];
      // 既定の fake は findById が Option.none を返す。
      const runtime = makeRuntime({
        userRepository: {
          updatePassword: (user) =>
            Effect.sync(() => {
              updated.push(user);
            }),
        },
      });

      const response = await putPassword(runtime, FIXED_UUID, requestBody);

      expect(response.status).toBe(HttpStatus.NotFound);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.ResourceNotFound,
        message: ErrorMessage.NotFound,
      });
      expect(updated).toStrictEqual([]);
    });

    test("契約に反する新パスワードの場合、400 と該当フィールドを返すこと", async () => {
      const runtime = makeRuntime({
        userRepository: {
          findById: () => Effect.succeed(Option.some(makeUser())),
        },
      });

      const response = await putPassword(runtime, FIXED_UUID, {
        ...requestBody,
        newPassword: "short",
      });

      expect(response.status).toBe(HttpStatus.BadRequest);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.BadRequest,
        message: ErrorMessage.BadRequest,
        details: [{ field: "newPassword", message: expect.any(String) }],
      });
    });
  });
  describe("認可", () => {
    test("他人の id を指定した場合、403 (errorCode 4030) を返し、集約を読まないこと", async () => {
      // 現在のパスワード照合 (401) より前に落ちること。守りを 2 枚にしている。
      let read = false;
      const runtime = makeRuntime({
        userRepository: {
          findById: () => {
            read = true;
            return Effect.succeed(Option.some(makeUser()));
          },
        },
      });

      const response = await putPassword(runtime, OTHER_UUID, requestBody);

      expect(response.status).toBe(HttpStatus.Forbidden);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.Forbidden,
        message: ErrorMessage.Forbidden,
      });
      expect(read).toBe(false);
    });
  });
});
