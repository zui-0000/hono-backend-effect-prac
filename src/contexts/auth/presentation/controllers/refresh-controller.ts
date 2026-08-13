import { Effect } from "effect";

import { Refresh200Response } from "~/generated/auth";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  refreshCommand,
  RefreshCommandInput,
} from "../../application/refresh-command";
import {
  type RefreshCookie,
  refreshTokenOf,
  setRefreshCookie,
} from "../refresh-cookie";

type RefreshControllerInput = { cookie: RefreshCookie };

/**
 * アクセストークンを再発行する (POST /auth/refresh)。
 *
 * **券は本文ではなく Cookie から受け取る。** ブラウザが自動で送るので、
 * クライアントの JS は何もしない (`credentials: 'include'` を付けるだけ)。
 *
 * ローテーションで発行した新しい券も Cookie で返す。同じ名前を上書きするので、
 * クライアント側の差し替え処理も要らない。
 */
export const refreshController = ({ cookie }: RefreshControllerInput) =>
  decodeInput(RefreshCommandInput)({ refreshToken: refreshTokenOf(cookie) })
    .pipe(Effect.flatMap(refreshCommand))
    .pipe(
      Effect.flatMap(({ accessToken, refreshToken }) =>
        Effect.succeed({ accessToken })
          .pipe(SuccessResponse.Ok(Refresh200Response))
          .pipe(setRefreshCookie(refreshToken)),
      ),
    );
