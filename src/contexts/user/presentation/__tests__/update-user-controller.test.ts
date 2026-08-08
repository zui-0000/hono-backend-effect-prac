import { describe, expect, test } from "bun:test";

import { Effect, Option, Schema } from "effect";

import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { makeRuntime } from "~/__mocks__/app-runtime";
import {
  REQUEST_ID,
  FIXED_UUID,
  OTHER_UUID,
  headers,
  makeUser,
} from "~/__mocks__/data";
import { User } from "~/contexts/user/domain/model/user";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";
const putUser = async (
  runtime: AppRuntime,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });


describe("PUT /users/:id", () => {
  const updateBody = {
    name: "アスカ・改",
    mailAddress: "asuka.new@example.com",
  };

  test("正常系: 204 を返し、更新後の集約を永続化する", async () => {
    const existing = makeUser();
    const updated: User[] = [];
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(existing)),
        updateProfile: (user) =>
          Effect.sync(() => {
            updated.push(user);
          }),
      },
    });

    const response = await putUser(runtime, FIXED_UUID, updateBody);

    expect(response.status).toBe(HttpStatus.NoContent);
    expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    // 204 は本文を持たない。
    expect(await response.text()).toBe("");

    expect(updated).toHaveLength(1);
    expect(updated[0]?.name).toBe(updateBody.name as UserName);
    expect(updated[0]?.mailAddress).toBe(updateBody.mailAddress as MailAddress);
    // changeProfile が触らない項目はそのまま引き継がれる。
    expect(updated[0]?.id).toBe(existing.id);
    expect(updated[0]?.hashedPassword).toBe(existing.hashedPassword);
    expect(updated[0]?.createdAt).toEqual(existing.createdAt);
    // updatedAt だけが進む。
    expect(updated[0]?.updatedAt.getTime()).toBeGreaterThan(
      existing.updatedAt.getTime(),
    );
    // 元の集約は書き換わらない (イミュータブル)。
    expect(existing.name).toBe("既存ユーザー" as UserName);
  });

  test("正常系: メールアドレスを変えない更新は重複扱いにしない", async () => {
    // 自分自身が findByMailAddress にヒットする状況。
    const existing = makeUser({ mailAddress: updateBody.mailAddress });
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(existing)),
        findByMailAddress: () => Effect.succeed(Option.some(existing)),
      },
    });

    const response = await putUser(runtime, FIXED_UUID, updateBody);

    expect(response.status).toBe(HttpStatus.NoContent);
  });

  test("異常系: 他人が使っているメールアドレスは 409 (errorCode 4091)", async () => {
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(makeUser())),
        findByMailAddress: () =>
          Effect.succeed(
            Option.some(
              makeUser({ id: OTHER_UUID, mailAddress: updateBody.mailAddress }),
            ),
          ),
      },
    });

    const response = await putUser(runtime, FIXED_UUID, updateBody);

    expect(response.status).toBe(HttpStatus.Conflict);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.MailAddressAlreadyExists,
    });
  });

  test("異常系: 存在しない id は 404 (errorCode 4040)", async () => {
    // 既定の fake は findById が Option.none を返す。
    const response = await putUser(makeRuntime(), FIXED_UUID, updateBody);

    expect(response.status).toBe(HttpStatus.NotFound);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.ResourceNotFound,
    });
  });

  test("異常系: 契約に反するボディは 400 と該当フィールド", async () => {
    const response = await putUser(makeRuntime(), FIXED_UUID, {
      ...updateBody,
      mailAddress: "not-a-mail",
    });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "mailAddress" }],
    });
  });
});
