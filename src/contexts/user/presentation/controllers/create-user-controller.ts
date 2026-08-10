import { Effect } from "effect";

import type { CreateUserBody } from "~/generated/users";
import { decodeInput } from "~/shared/presentation/decode-input";

import {
  createUserCommand,
  CreateUserCommandInput,
} from "../../application/create-user-command";

type CreateUserControllerInput = { body: typeof CreateUserBody.Type };

/**
 * ユーザーを新規作成する (POST /users)。
 */
export const createUserController = ({ body }: CreateUserControllerInput) =>
  Effect.gen(function* () {
    const input = yield* decodeInput(CreateUserCommandInput, body);

    const id = yield* createUserCommand(input);
    return { id };
  });
