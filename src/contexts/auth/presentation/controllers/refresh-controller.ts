import { Effect } from "effect";

import { Refresh200Response, type RefreshBody } from "~/generated/auth";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  refreshCommand,
  RefreshCommandInput,
} from "../../application/refresh-command";

type RefreshControllerInput = { body: typeof RefreshBody.Type };

/**
 * アクセストークンを再発行する (POST /auth/refresh)。
 */
export const refreshController = ({ body }: RefreshControllerInput) =>
  decodeInput(RefreshCommandInput)(body)
    .pipe(Effect.flatMap(refreshCommand))
    .pipe(SuccessResponse.Ok(Refresh200Response));
