import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import {
  EXISTING_HASH,
  FAKE_HASH,
  FIXED_UUID,
  headers,
  makeUser,
} from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { User } from "~/contexts/user/domain/model/user";
import type { UserHashedPassword } from "~/contexts/user/domain/model/value-objects/user-hashed-password";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { HttpStatus } from "~/shared/presentation/constants/http-status";
const putPassword = async (
  runtime: AppRuntime,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}/password`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

describe("PUT /users/:id/password", () => {
  const passwordBody = {
    currentPassword: "SuperSecret123!",
    newPassword: "BrandNewSecret456!",
  };

  test("正常系: 204 を返し、新しいハッシュだけを差し替えて永続化する", async () => {
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

    const response = await putPassword(runtime, FIXED_UUID, passwordBody);

    expect(response.status).toBe(HttpStatus.NoContent);
    expect(await response.text()).toBe("");

    // 照合するのは「現在のパスワード」と「保存済みのハッシュ」。
    expect(verified).toEqual([[passwordBody.currentPassword, EXISTING_HASH]]);

    expect(updated).toHaveLength(1);
    // 保存されるのは新しい平文のハッシュ (平文そのものは決して入らない)。
    expect(updated[0]?.hashedPassword).toBe(FAKE_HASH as UserHashedPassword);
    // パスワード以外は据え置き。
    expect(updated[0]?.id).toBe(existing.id);
    expect(updated[0]?.name).toBe(existing.name);
    expect(updated[0]?.mailAddress).toBe(existing.mailAddress);
    expect(updated[0]?.createdAt).toEqual(existing.createdAt);
    // updatedAt だけが進む。
    expect(updated[0]?.updatedAt.getTime()).toBeGreaterThan(
      existing.updatedAt.getTime(),
    );
    // 元の集約は書き換わらない (イミュータブル)。
    expect(existing.hashedPassword).toBe(EXISTING_HASH as UserHashedPassword);
  });

  test("異常系: 現在のパスワードが違えば 401 で、永続化も走らない", async () => {
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

    const response = await putPassword(runtime, FIXED_UUID, passwordBody);

    expect(response.status).toBe(HttpStatus.Unauthorized);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.Unauthorized,
    });
    expect(updated).toEqual([]);
  });

  test("異常系: 存在しない id は 404 (errorCode 4040)", async () => {
    // 既定の fake は findById が Option.none を返す。
    const response = await putPassword(makeRuntime(), FIXED_UUID, passwordBody);

    expect(response.status).toBe(HttpStatus.NotFound);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.ResourceNotFound,
    });
  });

  test("異常系: 契約に反する新パスワードは 400 と該当フィールド", async () => {
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(makeUser())),
      },
    });

    const response = await putPassword(runtime, FIXED_UUID, {
      ...passwordBody,
      newPassword: "short",
    });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "newPassword" }],
    });
  });
});
