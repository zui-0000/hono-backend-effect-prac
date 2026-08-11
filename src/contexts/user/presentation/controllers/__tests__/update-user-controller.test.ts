import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FIXED_UUID, headers, makeUser, OTHER_UUID } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { User } from "~/contexts/user/domain/model/user";
import type { UserName } from "~/contexts/user/domain/model/value-objects/user-name";
import { UpdateUserBody } from "~/generated/users";
import type { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { updateUserController } from "../update-user-controller";

const putUser = async (
  runtime: AppRuntime,
  id: string,
  requestBody: typeof UpdateUserBody.Encoded,
): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(requestBody),
  });

describe(updateUserController.name, () => {
  const requestBody = {
    name: "更新後ユーザー",
    mailAddress: "updated@example.com",
  } satisfies typeof UpdateUserBody.Encoded;

  describe("正常系", () => {
    test("更新が通る場合、204 を返し、更新後の集約を永続化すること", async () => {
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

      const response = await putUser(runtime, FIXED_UUID, requestBody);

      expect(response.status).toBe(HttpStatus.NoContent);
      // 204 は本文を持たない。
      expect(await response.text()).toBe("");

      expect(updated).toHaveLength(1);
      expect(updated[0]?.name).toBe(requestBody.name as UserName);
      expect(updated[0]?.mailAddress).toBe(
        requestBody.mailAddress as MailAddress,
      );
      // changeProfile が触らない項目はそのまま引き継がれる。
      expect(updated[0]?.id).toBe(existing.id);
      expect(updated[0]?.hashedPassword).toBe(existing.hashedPassword);
      expect(updated[0]?.createdAt).toStrictEqual(existing.createdAt);
      // updatedAt だけが進む。
      expect(updated[0]?.updatedAt.getTime()).toBeGreaterThan(
        existing.updatedAt.getTime(),
      );
      // 元の集約は書き換わらない (イミュータブル)。
      expect(existing.name).toBe("既存ユーザー" as UserName);
    });

    test("メールアドレスを変えない場合、自分自身を重複扱いにせず永続化すること", async () => {
      const updated: User[] = [];
      // 自分自身が findByMailAddress にヒットする状況。
      const existing = makeUser({ mailAddress: requestBody.mailAddress });
      const runtime = makeRuntime({
        userRepository: {
          findById: () => Effect.succeed(Option.some(existing)),
          findByMailAddress: () => Effect.succeed(Option.some(existing)),
          updateProfile: (user) =>
            Effect.sync(() => {
              updated.push(user);
            }),
        },
      });

      const response = await putUser(runtime, FIXED_UUID, requestBody);

      expect(response.status).toBe(HttpStatus.NoContent);
      // 204 だけを見ると「弾かれずに済んだ」としか分からない。更新が走ることまで見る。
      expect(updated).toHaveLength(1);
    });
  });

  describe("異常系", () => {
    test("他人が使っているメールアドレスの場合、409 を返し、永続化も走らないこと", async () => {
      const updated: User[] = [];
      const runtime = makeRuntime({
        userRepository: {
          findById: () => Effect.succeed(Option.some(makeUser())),
          updateProfile: (user) =>
            Effect.sync(() => {
              updated.push(user);
            }),
          findByMailAddress: () =>
            Effect.succeed(
              Option.some(
                makeUser({
                  id: OTHER_UUID,
                  mailAddress: requestBody.mailAddress,
                }),
              ),
            ),
        },
      });

      const response = await putUser(runtime, FIXED_UUID, requestBody);

      expect(response.status).toBe(HttpStatus.Conflict);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.MailAddressAlreadyExists,
        message: ErrorMessage.MailAddressAlreadyExists,
      });
      expect(updated).toStrictEqual([]);
    });

    test("存在しない id の場合、404 を返し、永続化も走らないこと", async () => {
      const updated: User[] = [];
      // 既定の fake は findById が Option.none を返す。
      const runtime = makeRuntime({
        userRepository: {
          updateProfile: (user) =>
            Effect.sync(() => {
              updated.push(user);
            }),
        },
      });

      const response = await putUser(runtime, FIXED_UUID, requestBody);

      expect(response.status).toBe(HttpStatus.NotFound);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.ResourceNotFound,
        message: ErrorMessage.NotFound,
      });
      expect(updated).toStrictEqual([]);
    });

    test("契約に反するボディの場合、400 と該当フィールドを返すこと", async () => {
      const runtime = makeRuntime();

      const response = await putUser(runtime, FIXED_UUID, {
        ...requestBody,
        mailAddress: "not-a-mail",
      });

      expect(response.status).toBe(HttpStatus.BadRequest);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.BadRequest,
        message: ErrorMessage.BadRequest,
        details: [{ field: "mailAddress", message: expect.any(String) }],
      });
    });
  });
  describe("認可", () => {
    test("他人の id を指定した場合、403 (errorCode 4030) を返し、集約を読まないこと", async () => {
      let read = false;
      const runtime = makeRuntime({
        userRepository: {
          findById: () => {
            read = true;
            return Effect.succeed(Option.some(makeUser()));
          },
        },
      });

      const response = await putUser(runtime, OTHER_UUID, requestBody);

      expect(response.status).toBe(HttpStatus.Forbidden);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.Forbidden,
        message: ErrorMessage.Forbidden,
      });
      expect(read).toBe(false);
    });
  });
});
