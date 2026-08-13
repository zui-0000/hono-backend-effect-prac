import { Effect } from "effect";

import type { AccessTokenClaims } from "~/shared/domain/access-token-issuer";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  LogoutCommandInput,
  logoutCommand,
} from "../../application/logout-command";
import { clearRefreshCookie } from "../refresh-cookie";

type LogoutControllerInput = { auth: AccessTokenClaims };

/**
 * セッションを終了する (POST /auth/logout)。
 *
 * ボディもパスパラメータも無く、入力は **Bearer の claims だけ**。
 * 署名の検証は handleWithEffect が済ませているので、ここに届く sid は信用してよい。
 *
 * **Cookie も消す。** サーバ側でセッションを失効させるだけでは、ブラウザが
 * 2 週間送り続ける。届いた失効済みの券は盗難検出のログを埋めるので、
 * 出口で消しておく (`clearRefreshCookie` の doc)。
 *
 * decodeInput を通すのは、claims の sid が素の Uuid だから
 * (shared は contexts を知れないので branded にできない)。
 * auth の語彙である SessionId へ変換するのはこの層の仕事。
 */
export const logoutController = ({ auth }: LogoutControllerInput) =>
  decodeInput(LogoutCommandInput)({ sessionId: auth.sid })
    .pipe(Effect.flatMap(logoutCommand))
    .pipe(SuccessResponse.NoContent)
    .pipe(clearRefreshCookie);
