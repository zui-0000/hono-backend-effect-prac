import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { REQUEST_ID, FIXED_UUID, headers } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import type { GetUserQueryOutput } from "~/contexts/user/application/get-user-query-service";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";
const getUser = async (runtime: AppRuntime, id: string): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, { headers });

describe("GET /users/:id", () => {
  test("正常系: 200 を返し、契約どおり name / mailAddress のみを含む", async () => {
    const dto: GetUserQueryOutput = {
      name: "アスカ",
      mailAddress: "asuka@example.com",
    };
    const runtime = makeRuntime({
      getUserQueryService: { execute: () => Effect.succeed(Option.some(dto)) },
    });

    const response = await getUser(runtime, FIXED_UUID);

    expect(response.status).toBe(HttpStatus.Ok);
    // 封筒 (result / meta) で包まず、リソースの内容をそのまま返す。
    expect(await response.json()).toEqual({
      name: dto.name,
      mailAddress: dto.mailAddress,
    });
  });

  test("異常系: 存在しない id は 404 (errorCode 4040)", async () => {
    // 既定の fake は Option.none を返す = 見つからない。
    const response = await getUser(makeRuntime(), FIXED_UUID);

    expect(response.status).toBe(HttpStatus.NotFound);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.ResourceNotFound,
    });
  });

  test("異常系: uuid v7 形式でない id は 400 と該当フィールド", async () => {
    const response = await getUser(makeRuntime(), "not-a-uuid");

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "id" }],
    });
  });

  test("異常系: 契約とズレた応答は defect となり、契約どおりの 500 を返す", async () => {
    // 射影が契約を満たさない状況 (mailAddress が文字列でない)。
    // handleWithEffect の orDie で defect になり、E チャネルには現れない。
    const runtime = makeRuntime({
      getUserQueryService: {
        execute: () =>
          Effect.succeed(
            Option.some({
              name: "アスカ",
              mailAddress: 42 as unknown as string,
            }),
          ),
      },
    });

    const response = await getUser(runtime, FIXED_UUID);

    // Hono 既定の平文 500 ではなく、契約の InternalServerError が返る。
    expect(response.status).toBe(HttpStatus.InternalServerError);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.InternalServerError,
    });
    // defect 経路でも相関 ID は失われない (ログと突き合わせられる)。
    expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
  });
});
