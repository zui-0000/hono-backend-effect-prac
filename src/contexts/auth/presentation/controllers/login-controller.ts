import { Effect } from "effect";

import { Login200Response, type LoginBody } from "~/generated/auth";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  LoginCommandInput,
  loginCommand,
} from "../../application/login-command";
import { setRefreshCookie } from "../refresh-cookie";

type LoginControllerInput = { body: typeof LoginBody.Type };

/**
 * メールアドレスとパスワードで券を発行する (POST /auth/login)。
 *
 * **券の組を 2 つの経路に振り分ける。** アクセストークンは本文、
 * リフレッシュトークンは HttpOnly Cookie。後者を本文に載せると JS から読めてしまい、
 * XSS を踏んだ瞬間に 2 週間有効な券が漏れる (経緯は refresh-cookie.ts)。
 */
export const loginController = ({ body }: LoginControllerInput) =>
  decodeInput(LoginCommandInput)(body)
    .pipe(Effect.flatMap(loginCommand))
    .pipe(
      Effect.flatMap(({ accessToken, refreshToken }) =>
        Effect.succeed({ accessToken })
          .pipe(SuccessResponse.Ok(Login200Response))
          .pipe(setRefreshCookie(refreshToken)),
      ),
    );
