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
  Effect.gen(function* () {
    const input = yield* decodeInput(LoginCommandInput, body);

    return yield* loginCommand(input).pipe(
      SuccessResponse.Ok(Login200Response),
    );
  });
