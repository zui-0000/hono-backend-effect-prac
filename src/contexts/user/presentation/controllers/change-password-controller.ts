import { Effect } from "effect";

import type {
  ChangePasswordBody,
  ChangePasswordParams,
} from "~/generated/users";
import { decodeInput } from "~/shared/presentation/decode-input";

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
  Effect.gen(function* () {
    const input = yield* decodeInput(ChangePasswordCommandInput, {
      ...body,
      id: params.id,
    });

    yield* changePasswordCommand(input);
  });
