import { Effect } from "effect";

import type {
  ChangePasswordBody,
  ChangePasswordParams,
} from "~/generated/users";
import type { AccessTokenClaims } from "~/shared/domain/access-token-issuer";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  changePasswordCommand,
  ChangePasswordCommandInput,
} from "../../application/change-password-command";

type ChangePasswordControllerInput = {
  auth: AccessTokenClaims;
  body: typeof ChangePasswordBody.Type;
  params: typeof ChangePasswordParams.Type;
};

/**
 * パスワードを変更する (PUT /users/{id}/password)。
 */
export const changePasswordController = ({
  auth,
  body,
  params,
}: ChangePasswordControllerInput) =>
  decodeInput(ChangePasswordCommandInput)({
    ...body,
    id: params.id,
    actor: auth.sub,
  })
    .pipe(Effect.flatMap(changePasswordCommand))
    .pipe(SuccessResponse.NoContent);
