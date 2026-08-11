import { Effect } from "effect";

import type { UpdateUserBody, UpdateUserParams } from "~/generated/users";
import type { AccessTokenClaims } from "~/shared/domain/access-token-issuer";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  updateUserCommand,
  UpdateUserCommandInput,
} from "../../application/update-user-command";

type UpdateUserControllerInput = {
  auth: AccessTokenClaims;
  body: typeof UpdateUserBody.Type;
  params: typeof UpdateUserParams.Type;
};

/**
 * ユーザーを更新する (PUT /users/{id})。
 */
export const updateUserController = ({
  auth,
  body,
  params,
}: UpdateUserControllerInput) =>
  decodeInput(UpdateUserCommandInput)({
    ...body,
    id: params.id,
    actor: auth.sub,
  })
    .pipe(Effect.flatMap(updateUserCommand))
    .pipe(SuccessResponse.NoContent);
