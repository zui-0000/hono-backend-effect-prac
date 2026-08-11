import { Effect } from "effect";

import type { DeleteUserParams } from "~/generated/users";
import type { AccessTokenClaims } from "~/shared/domain/access-token-issuer";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  deleteUserCommand,
  DeleteUserCommandInput,
} from "../../application/delete-user-command";

type DeleteUserControllerInput = {
  auth: AccessTokenClaims;
  params: typeof DeleteUserParams.Type;
};

/**
 * ユーザーを削除する (DELETE /users/{id})。
 */
export const deleteUserController = ({
  auth,
  params,
}: DeleteUserControllerInput) =>
  decodeInput(DeleteUserCommandInput)({ id: params.id, actor: auth.sub })
    .pipe(Effect.flatMap(deleteUserCommand))
    .pipe(SuccessResponse.NoContent);
