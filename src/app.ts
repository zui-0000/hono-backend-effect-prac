import { Hono } from "hono";

import type { AppRuntime } from "~/app-runtime";
import { authRoutes } from "~/contexts/auth/presentation/auth-routes";
import { userRoutes } from "~/contexts/user/presentation/user-routes";
import {
  notFoundResponse,
  requestContext,
  type RequestContextEnv,
} from "~/shared/presentation/request-context";

/**
 * アプリ全体を組み立てる。
 *
 * ここが知っているのは「どのコンテキストを、どのパスにマウントするか」だけ。
 * 個々のエンドポイント (メソッド・ステータス・応答スキーマ) は各コンテキストの
 * `*-routes.ts` が持つので、エンドポイントが増えてもこのファイルは育たない。
 *
 * ランタイム (= 構築済みの依存) を引数で受け取り、各ルータへ渡す。
 * 依存の差し替え点をこの一箇所に集めることで、テストでは fake の Layer から
 * 作ったランタイムを渡すだけで、HTTP 境界ごと検証できる。
 *
 * middleware をここに 1 枚だけ置いている。相関 ID は**経路にマッチしなかった
 * リクエストにも要る**ため、経路ごとの handleWithEffect では覆えないから。
 * 認証と契約検証は経路ごとに要否が変わるので、外には出さない。
 */
export const createApp = (runtime: AppRuntime) => {
  const app = new Hono<RequestContextEnv>();

  app.use("*", requestContext(runtime));
  app.notFound(notFoundResponse);

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/users", userRoutes(runtime));
  app.route("/auth", authRoutes(runtime));

  return app;
};
