import { Effect } from "effect";

import type { UpdateUserBody, UpdateUserParams } from "~/generated/users";
import { decodeInput } from "~/shared/presentation/decode-input";

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
  Effect.gen(function* () {
    const input = yield* decodeInput(UpdateUserCommandInput, {
      ...body,
      id: params.id,
    });

    yield* updateUserCommand(input);
  });
