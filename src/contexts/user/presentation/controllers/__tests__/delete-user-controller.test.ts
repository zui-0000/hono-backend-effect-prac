import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FIXED_UUID, headers, makeUser, OTHER_UUID } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import type { UserId } from "~/contexts/user/domain/model/value-objects/user-id";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { deleteUserController } from "../delete-user-controller";

const deleteUser = async (runtime: AppRuntime, id: string): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, {
    method: "DELETE",
    headers,
  });

describe(deleteUserController.name, () => {
  describe("正常系", () => {
    test("対象が存在する場合、204 を返し、その id を削除すること", async () => {
      const deleted: string[] = [];
      const runtime = makeRuntime({
        userRepository: {
          findById: () => Effect.succeed(Option.some(makeUser())),
          deleteById: (id) =>
            Effect.sync(() => {
              deleted.push(id);
            }),
        },
      });

      const response = await deleteUser(runtime, FIXED_UUID);

      expect(response.status).toBe(HttpStatus.NoContent);
      expect(await response.text()).toBe("");
      expect(deleted).toStrictEqual([FIXED_UUID as UserId]);
    });
  });

  describe("異常系", () => {
    test("存在しない id の場合、404 を返し、削除も走らないこと", async () => {
      const deleted: string[] = [];
      const runtime = makeRuntime({
        userRepository: {
          deleteById: (id) =>
            Effect.sync(() => {
              deleted.push(id);
            }),
        },
      });

      const response = await deleteUser(runtime, FIXED_UUID);

      expect(response.status).toBe(HttpStatus.NotFound);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.ResourceNotFound,
        message: ErrorMessage.NotFound,
      });
      expect(deleted).toStrictEqual([]);
    });

    test("uuid v7 形式でない id の場合、400 と該当フィールドを返すこと", async () => {
      const runtime = makeRuntime();

      const response = await deleteUser(runtime, "not-a-uuid");

      expect(response.status).toBe(HttpStatus.BadRequest);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.BadRequest,
        message: ErrorMessage.BadRequest,
        details: [{ field: "id", message: expect.any(String) }],
      });
    });
  });
  describe("認可", () => {
    test("他人の id を指定した場合、403 (errorCode 4030) を返し、削除しないこと", async () => {
      const deleted: string[] = [];
      const runtime = makeRuntime({
        userRepository: {
          findById: () => Effect.succeed(Option.some(makeUser())),
          deleteById: (id) =>
            Effect.sync(() => {
              deleted.push(id);
            }),
        },
      });

      const response = await deleteUser(runtime, OTHER_UUID);

      expect(response.status).toBe(HttpStatus.Forbidden);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.Forbidden,
        message: ErrorMessage.Forbidden,
      });
      expect(deleted).toStrictEqual([]);
    });
  });
});
