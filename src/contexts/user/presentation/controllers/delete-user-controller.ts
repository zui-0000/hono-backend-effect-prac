import { Effect } from "effect";

import type { DeleteUserParams } from "~/generated/users";
import { decodeInput } from "~/shared/presentation/decode-input";

import {
  deleteUserCommand,
  DeleteUserCommandInput,
} from "../../application/delete-user-command";

type DeleteUserControllerInput = { params: typeof DeleteUserParams.Type };

/**
 * ユーザーを削除する (DELETE /users/{id})。
 */
export const deleteUserController = ({ params }: DeleteUserControllerInput) =>
  Effect.gen(function* () {
    const input = yield* decodeInput(DeleteUserCommandInput, {
      id: params.id,
    });

    yield* deleteUserCommand(input);
  });
