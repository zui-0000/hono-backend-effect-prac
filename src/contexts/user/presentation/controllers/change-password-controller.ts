import { Effect } from "effect";

import type {
  ChangePasswordBody,
  ChangePasswordParams,
} from "~/generated/users";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  changePasswordCommand,
  ChangePasswordCommandInput,
} from "../../application/change-password-command";

type ChangePasswordControllerInput = {
  body: typeof ChangePasswordBody.Type;
  params: typeof ChangePasswordParams.Type;
};

/**
 * パスワードを変更する (PUT /users/{id}/password)。
 */
export const changePasswordController = ({
  body,
  params,
}: ChangePasswordControllerInput) =>
  decodeInput(ChangePasswordCommandInput)({ ...body, id: params.id })
    .pipe(Effect.flatMap(changePasswordCommand))
    .pipe(SuccessResponse.NoContent);
