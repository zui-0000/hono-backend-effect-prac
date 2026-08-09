import { describe, expect, test } from "bun:test";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { headers } from "~/__mocks__/data";
import { createApp } from "~/app";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { ErrorMessage } from "~/shared/presentation/constants/error-message";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { handleNotFound } from "../handle-not-found";

/**
 * Hono 既定は平文の `404 Not Found` で、契約のエラー本文と形が違う。
 * 経路の打ち間違いだけクライアントの分岐が変わる、という事故を防ぐ。
 */
describe(handleNotFound.name, () => {
  describe("異常系", () => {
    test("経路にマッチしない場合、契約と同じ形の 404 を返すこと", async () => {
      const app = createApp(makeRuntime());

      const response = await app.request("/unknown", { headers });

      expect(response.status).toBe(HttpStatus.NotFound);
      // 「存在しない id を指定した 404」と同じ errorCode / message になる。
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.ResourceNotFound,
        message: ErrorMessage.NotFound,
      });
    });

    test("許可されないメソッドの場合、契約と同じ形の 404 を返すこと", async () => {
      const app = createApp(makeRuntime());

      const response = await app.request("/users", {
        method: "PATCH",
        headers,
      });

      expect(response.status).toBe(HttpStatus.NotFound);
      expect(await response.json()).toStrictEqual({
        errorCode: ErrorCode.ResourceNotFound,
        message: ErrorMessage.NotFound,
      });
    });
  });
});
