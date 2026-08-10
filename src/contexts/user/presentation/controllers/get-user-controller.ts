import { Effect } from "effect";

import type { GetUserParams } from "~/generated/users";
import { orNotFound } from "~/shared/application/or-not-found";

import { GetUserQueryService } from "../../application/get-user-query-service";

type GetUserControllerInput = { params: typeof GetUserParams.Type };

/**
 * ID を指定してユーザーを取得する (GET /users/{id})。
 */
export const getUserController = ({ params }: GetUserControllerInput) =>
  Effect.gen(function* () {
    const getUserQueryService = yield* GetUserQueryService;

    const user = yield* getUserQueryService.execute(params.id).pipe(orNotFound);
    return { name: user.name, mailAddress: user.mailAddress };
  });
