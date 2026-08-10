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
  Effect.gen(function* () {
    const input = yield* decodeInput(RefreshCommandInput, body);
    return yield* refreshCommand(input).pipe(
      SuccessResponse.Ok(Refresh200Response),
    );
  });
