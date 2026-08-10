import { Hono } from "hono";

import {
  LoginBody,
  LoginHeader,
  LogoutHeader,
  RefreshBody,
  RefreshHeader,
} from "~/generated/auth";
import { handleWithEffect } from "~/shared/presentation/handle-with-effect";
import type { RequestIdEnv } from "~/shared/presentation/resolve-request-id";

import type { AuthRuntime } from "../auth-runtime";
import { loginController } from "./controllers/login-controller";
import { logoutController } from "./controllers/logout-controller";
import { refreshController } from "./controllers/refresh-controller";

/**
 * auth コンテキストの HTTP 経路。パスは TypeSpec の @route と対応する
 * (このルータ自体は app.ts が "/auth" にマウントするので、ここでは相対パス)。
 *
 * logout だけが認証を要する。`auth: true` を宣言すると handleWithEffect が
 * Bearer を検証し、controller の入力に claims が載る。
 */
export const authRoutes = (runtime: AuthRuntime): Hono<RequestIdEnv> => {
  const routes = new Hono<RequestIdEnv>();

  routes.post(
    "/login",
    handleWithEffect({
      request: { header: LoginHeader, body: LoginBody },
      controller: loginController,
    })(runtime),
  );

  routes.post(
    "/refresh",
    handleWithEffect({
      request: { header: RefreshHeader, body: RefreshBody },
      controller: refreshController,
    })(runtime),
  );

  routes.post(
    "/logout",
    handleWithEffect({
      auth: true,
      request: { header: LogoutHeader },
      controller: logoutController,
    })(runtime),
  );

  return routes;
};
