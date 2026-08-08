import { Effect } from "effect";

import type { AccessTokenClaims } from "~/shared/domain/access-token-issuer";
import { decodeInput } from "~/shared/presentation/request-validator";

import {
  LogoutCommandInput,
  logoutCommand,
} from "../../application/logout-command";

type LogoutControllerInput = { auth: AccessTokenClaims };

/**
 * セッションを終了する (POST /auth/logout)。
 *
 * ボディもパスパラメータも無く、入力は **Bearer の claims だけ**。
 * 署名の検証は handleWithEffect が済ませているので、ここに届く sid は信用してよい。
 *
 * decodeInput を通すのは、claims の sid が素の Uuid だから
 * (shared は contexts を知れないので branded にできない)。
 * auth の語彙である SessionId へ変換するのはこの層の仕事。
 */
export const logoutController = ({ auth }: LogoutControllerInput) =>
  Effect.gen(function* () {
    const input = yield* decodeInput(LogoutCommandInput, {
      sessionId: auth.sid,
    });

    yield* logoutCommand(input);
  });
