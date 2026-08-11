import { Effect } from "effect";

import { Login200Response, type LoginBody } from "~/generated/auth";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  LoginCommandInput,
  loginCommand,
} from "../../application/login-command";

type LoginControllerInput = { body: typeof LoginBody.Type };

/**
 * メールアドレスとパスワードで券を発行する (POST /auth/login)。
 */
export const loginController = ({ body }: LoginControllerInput) =>
  decodeInput(LoginCommandInput)(body)
    .pipe(Effect.flatMap(loginCommand))
    .pipe(SuccessResponse.Ok(Login200Response));
