import { describe, expect, test } from "bun:test";

import { makeRuntime } from "~/__mocks__/app-runtime";
import { FIXED_UUID, headers, REQUEST_ID } from "~/__mocks__/data";
import { createApp } from "~/app";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

import { resolveRequestId } from "../resolve-request-id";

/**
 * 最外周の middleware。**経路にマッチしないリクエスト**を主に見る。
 *
 * `handleWithEffect` はマッチした経路でしか走らないので、ここが無いと
 * パスの打ち間違いも許可されないメソッドも、相関 ID もログも無いまま
 * Hono 既定の平文 404 になる。**調べたい場面でちょうど手掛かりが消える**。
 */
describe(resolveRequestId.name, () => {
  describe("正常系", () => {
    test("経路にマッチしない場合でも、受け取った相関 ID を応答に返すこと", async () => {
      const app = createApp(makeRuntime());

      const response = await app.request("/unknown", { headers });

      expect(response.status).toBe(HttpStatus.NotFound);
      expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    });

    test("契約に無い経路 (/health) の場合でも、相関 ID を応答に返すこと", async () => {
      const app = createApp(makeRuntime());

      const response = await app.request("/health", { headers });

      expect(response.status).toBe(HttpStatus.Ok);
      expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    });
  });

  describe("異常系", () => {
    test("ログに載せられない相関 ID の場合、採番した値で置き換えること", async () => {
      const app = createApp(makeRuntime());

      // 空白を含む値。そのままログに載せるとログインジェクションになりうる。
      const response = await app.request("/unknown", {
        headers: { [HttpHeader.RequestId]: "bad id" },
      });

      // **採番するのはこの middleware だけ。** 2 箇所で採番していた頃なら、
      // 応答ヘッダとログに別々の ID が載っていた。
      expect(response.headers.get(HttpHeader.RequestId)).toBe(FIXED_UUID);
    });
  });
});
