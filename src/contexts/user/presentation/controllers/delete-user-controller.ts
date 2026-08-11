import { Effect } from "effect";

import type { DeleteUserParams } from "~/generated/users";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  deleteUserCommand,
  DeleteUserCommandInput,
} from "../../application/delete-user-command";

type DeleteUserControllerInput = { params: typeof DeleteUserParams.Type };

/**
 * ユーザーを削除する (DELETE /users/{id})。
 */
export const deleteUserController = ({ params }: DeleteUserControllerInput) =>
  decodeInput(DeleteUserCommandInput)({ id: params.id })
    .pipe(Effect.flatMap(deleteUserCommand))
    .pipe(SuccessResponse.NoContent);
