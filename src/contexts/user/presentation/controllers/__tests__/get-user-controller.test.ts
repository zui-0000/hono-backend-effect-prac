import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FIXED_UUID, headers, OTHER_UUID } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import type { GetUserQueryOutput } from "~/contexts/user/application/get-user-query-service";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { getUserController } from "../get-user-controller";

const getUser = async (runtime: AppRuntime, id: string): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, { headers });

describe(getUserController.name, () => {
  describe("正常系", () => {
    test("対象が存在する場合、200 を返し、契約どおり name / mailAddress のみを含むこと", async () => {
      const dto: GetUserQueryOutput = {
        name: "取得ユーザー",
        mailAddress: "fetched@example.com",
      };
      const runtime = makeRuntime({
        getUserQueryService: {
          execute: () => Effect.succeed(Option.some(dto)),
        },
      });

      const response = await getUser(runtime, FIXED_UUID);

      expect(response.status).toBe(HttpStatus.Ok);
      // 封筒 (result / meta) で包まず、リソースの内容をそのまま返す。
      expect(await response.json()).toStrictEqual({
        name: dto.name,
        mailAddress: dto.mailAddress,
      });
    });
  });

  describe("異常系", () => {
    test("存在しない id の場合、404 (errorCode 4040) を返すこと", async () => {
      // 既定の fake は Option.none を返す = 見つからない。
      const runtime = makeRuntime();

      const response = await getUser(runtime, FIXED_UUID);

      expect(response.status).toBe(HttpStatus.NotFound);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.ResourceNotFound,
        message: ErrorMessage.NotFound,
      });
    });

    test("uuid v7 形式でない id の場合、400 と該当フィールドを返すこと", async () => {
      const runtime = makeRuntime();

      const response = await getUser(runtime, "not-a-uuid");

      expect(response.status).toBe(HttpStatus.BadRequest);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.BadRequest,
        message: ErrorMessage.BadRequest,
        details: [{ field: "id", message: expect.any(String) }],
      });
    });
  });
  describe("認可", () => {
    test("他人の id を指定した場合、403 (errorCode 4030) を返し、クエリを実行しないこと", async () => {
      // 対象の存在を確かめる前に落とす = 「認可の失敗は対象の有無に関わらず 403」。
      let executed = false;
      const runtime = makeRuntime({
        getUserQueryService: {
          execute: () => {
            executed = true;
            return Effect.succeed(Option.none());
          },
        },
      });

      // headers の claims は sub = FIXED_UUID。別人の id を狙う。
      const response = await getUser(runtime, OTHER_UUID);

      expect(response.status).toBe(HttpStatus.Forbidden);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.Forbidden,
        message: ErrorMessage.Forbidden,
      });
      expect(executed).toBe(false);
    });
  });
});
