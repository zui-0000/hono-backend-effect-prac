import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { REQUEST_ID, FIXED_UUID, headers, makeUser } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import type { UserId } from "~/contexts/user/domain/model/value-objects/user-id";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";
const deleteUser = async (runtime: AppRuntime, id: string): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, {
    method: "DELETE",
    headers,
  });

describe("DELETE /users/:id", () => {
  test("正常系: 204 を返し、対象の id を削除する", async () => {
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
    expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    expect(await response.text()).toBe("");
    expect(deleted).toEqual([FIXED_UUID as UserId]);
  });

  test("異常系: 存在しない id は 404 で、削除も走らない", async () => {
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
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.ResourceNotFound,
    });
    expect(deleted).toEqual([]);
  });

  test("異常系: uuid v7 形式でない id は 400 と該当フィールド", async () => {
    const response = await deleteUser(makeRuntime(), "not-a-uuid");

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "id" }],
    });
  });
});
