import { Effect } from "effect";

import type { UpdateUserBody, UpdateUserParams } from "~/generated/users";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  updateUserCommand,
  UpdateUserCommandInput,
} from "../../application/update-user-command";

type UpdateUserControllerInput = {
  body: typeof UpdateUserBody.Type;
  params: typeof UpdateUserParams.Type;
};

/**
 * ユーザーを更新する (PUT /users/{id})。
 */
export const updateUserController = ({
  body,
  params,
}: UpdateUserControllerInput) =>
  decodeInput(UpdateUserCommandInput)({ ...body, id: params.id })
    .pipe(Effect.flatMap(updateUserCommand))
    .pipe(SuccessResponse.NoContent);
