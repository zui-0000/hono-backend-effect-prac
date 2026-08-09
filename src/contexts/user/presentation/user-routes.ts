import { Hono } from "hono";

import {
  ChangePasswordBody,
  ChangePasswordHeader,
  ChangePasswordParams,
  CreateUser201Response,
  CreateUserBody,
  CreateUserHeader,
  DeleteUserHeader,
  DeleteUserParams,
  GetUser200Response,
  GetUserHeader,
  GetUserParams,
  UpdateUserBody,
  UpdateUserHeader,
  UpdateUserParams,
} from "~/generated/users";
import { HttpStatus } from "~/shared/presentation/constants/http-status";
import { handleWithEffect } from "~/shared/presentation/handle-with-effect";
import type { RequestIdEnv } from "~/shared/presentation/resolve-request-id";

import type { UserRuntime } from "../user-runtime";
import { changePasswordController } from "./controllers/change-password-controller";
import { createUserController } from "./controllers/create-user-controller";
import { deleteUserController } from "./controllers/delete-user-controller";
import { getUserController } from "./controllers/get-user-controller";
import { updateUserController } from "./controllers/update-user-controller";

/**
 * user コンテキストの HTTP 経路。パスは TypeSpec の @route と対応する
 * (このルータ自体は app.ts が "/users" にマウントするので、ここでは相対パス)。
 *
 * **HTTP 契約の宣言をここに集約している** — 入力 (header / body / params) も
 * 出力 (status / responseSchema) も、このファイルを見れば一望できる。
 * controller 側は検証済みの入力を受け取ってユースケースを呼ぶだけ。
 *
 * 生成スキーマ (`~/generated`) を import してよいのは presentation 層だけなので、
 * この結び付けを app.ts (src 直下) に置くことはできない。
 *
 * `auth: true` は契約の `@useAuth(BearerAuth)` と 1 対 1。作成 (サインアップ想定) だけが
 * 認証不要で、残る 4 本は Bearer を要求する。宣言すると handleWithEffect が署名を検証し、
 * controller の入力に claims が載る。
 */
export const userRoutes = (runtime: UserRuntime): Hono<RequestIdEnv> => {
  const routes = new Hono<RequestIdEnv>();

  routes.post(
    "/",
    handleWithEffect({
      request: { header: CreateUserHeader, body: CreateUserBody },
      response: { status: HttpStatus.Created, body: CreateUser201Response },
      controller: createUserController,
    })(runtime),
  );

  routes.get(
    "/:id",
    handleWithEffect({
      auth: true,
      request: { header: GetUserHeader, params: GetUserParams },
      response: { status: HttpStatus.Ok, body: GetUser200Response },
      controller: getUserController,
    })(runtime),
  );

  routes.put(
    "/:id",
    handleWithEffect({
      auth: true,
      request: {
        header: UpdateUserHeader,
        body: UpdateUserBody,
        params: UpdateUserParams,
      },
      response: { status: HttpStatus.NoContent },
      controller: updateUserController,
    })(runtime),
  );

  routes.put(
    "/:id/password",
    handleWithEffect({
      auth: true,
      request: {
        header: ChangePasswordHeader,
        body: ChangePasswordBody,
        params: ChangePasswordParams,
      },
      response: { status: HttpStatus.NoContent },
      controller: changePasswordController,
    })(runtime),
  );

  routes.delete(
    "/:id",
    handleWithEffect({
      auth: true,
      request: {
        header: DeleteUserHeader,
        params: DeleteUserParams,
      },
      response: { status: HttpStatus.NoContent },
      controller: deleteUserController,
    })(runtime),
  );

  return routes;
};
