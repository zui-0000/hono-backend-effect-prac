import { Hono } from "hono";

import {
  Login200Response,
  LoginBody,
  LoginHeader,
  LogoutHeader,
  Refresh200Response,
  RefreshBody,
  RefreshHeader,
} from "~/generated/auth";
import { HttpStatus } from "~/shared/presentation/constants/http-status";
import { handleWithEffect } from "~/shared/presentation/handle-with-effect";

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
export const authRoutes = (runtime: AuthRuntime): Hono => {
  const routes = new Hono();

  routes.post(
    "/login",
    handleWithEffect({
      request: { header: LoginHeader, body: LoginBody },
      response: { status: HttpStatus.Ok, body: Login200Response },
      controller: loginController,
    })(runtime),
  );

  routes.post(
    "/refresh",
    handleWithEffect({
      request: { header: RefreshHeader, body: RefreshBody },
      response: { status: HttpStatus.Ok, body: Refresh200Response },
      controller: refreshController,
    })(runtime),
  );

  routes.post(
    "/logout",
    handleWithEffect({
      request: { header: LogoutHeader, auth: true },
      response: { status: HttpStatus.NoContent },
      controller: logoutController,
    })(runtime),
  );

  return routes;
};
