import { Effect } from "effect";

import {
  createUserCommand,
  CreateUserCommandInput,
} from "~/contexts/user/application/create-user-command";
import type { CreateUserBody } from "~/generated/users";
import { decodeInput } from "~/shared/presentation/request-validator";

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
