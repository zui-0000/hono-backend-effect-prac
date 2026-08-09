import { Effect } from "effect";

import {
  changePasswordCommand,
  ChangePasswordCommandInput,
} from "~/contexts/user/application/change-password-command";
import type {
  ChangePasswordBody,
  ChangePasswordParams,
} from "~/generated/users";
import { decodeInput } from "~/shared/presentation/decode-input";

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
