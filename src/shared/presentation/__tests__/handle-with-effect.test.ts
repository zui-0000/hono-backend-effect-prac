import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FIXED_UUID, headers, REQUEST_ID } from "~/__mocks__/data";
import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { handleWithEffect } from "../handle-with-effect";

/**
 * すべてのエンドポイントが共通で持つ振る舞い。
 *
 * controller 単位のファイルに置くと**同じ 1 行が 4 つ並ぶ**ので、
 * 横断的なものはここに集める（規約は docs/02-architecture.md）。
 * 経路として `GET /users/{id}` を借りているだけで、試しているのは user ではない。
 */
const getUser = async (runtime: AppRuntime): Promise<Response> =>
  await createApp(runtime).request(`/users/${FIXED_UUID}`, { headers });

describe(handleWithEffect.name, () => {
  describe("正常系", () => {
    test("成功した場合、受け取った相関 ID をそのまま応答に返すこと", async () => {
      const runtime = makeRuntime({
        getUserQueryService: {
          execute: () =>
            Effect.succeed(
              Option.some({
                name: "取得ユーザー",
                mailAddress: "fetched@example.com",
              }),
            ),
        },
      });

      const response = await getUser(runtime);

      expect(response.status).toBe(HttpStatus.Ok);
      // クライアントが採番した ID をそのまま返すことで、
      // client 側のログとサーバのログを突き合わせられる。
      expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    });
  });

  describe("異常系", () => {
    test("型付きエラーの場合でも、相関 ID を返すこと", async () => {
      // 既定の fake は Option.none を返す = 404 になる。
      const runtime = makeRuntime();

      const response = await getUser(runtime);

      expect(response.status).toBe(HttpStatus.NotFound);
      // **失敗したときこそ突き合わせたい。** 成功時だけ返す実装だと、
      // 調査したい場面でちょうど手掛かりが無くなる。
      expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    });

    test("応答が契約とズレた場合、defect として扱い、契約どおりの 500 を返すこと", async () => {
      // 射影が契約を満たさない状況 (mailAddress が文字列でない)。
      // handleWithEffect の orDie で defect になり、E チャネルには現れない。
      const runtime = makeRuntime({
        getUserQueryService: {
          execute: () =>
            Effect.succeed(
              Option.some({
                name: "取得ユーザー",
                mailAddress: 42 as unknown as string,
              }),
            ),
        },
      });

      const response = await getUser(runtime);

      // Hono 既定の平文 500 ではなく、契約の InternalServerError が返る。
      expect(response.status).toBe(HttpStatus.InternalServerError);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.InternalServerError,
        message: ErrorMessage.InternalServerError,
      });
      // defect 経路でも相関 ID は失われない。
      expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    });
  });
});
