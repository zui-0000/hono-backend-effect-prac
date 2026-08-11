import { Effect } from "effect";

import { CreateUser201Response, type CreateUserBody } from "~/generated/users";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  createUserCommand,
  CreateUserCommandInput,
} from "../../application/create-user-command";

type CreateUserControllerInput = { body: typeof CreateUserBody.Type };

/**
 * ユーザーを新規作成する (POST /users)。
 */
export const createUserController = ({ body }: CreateUserControllerInput) =>
  decodeInput(CreateUserCommandInput)(body)
    .pipe(Effect.flatMap(createUserCommand))
    .pipe(Effect.map((id) => ({ id })))
    .pipe(SuccessResponse.Created(CreateUser201Response));
