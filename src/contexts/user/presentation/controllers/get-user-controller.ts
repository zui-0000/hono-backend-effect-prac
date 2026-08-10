import { Effect } from "effect";

import { GetUser200Response, type GetUserParams } from "~/generated/users";
import { orNotFound } from "~/shared/application/or-not-found";
import { SuccessResponse } from "~/shared/presentation/success-response";

import { GetUserQueryService } from "../../application/get-user-query-service";

type GetUserControllerInput = { params: typeof GetUserParams.Type };

/**
 * ID を指定してユーザーを取得する (GET /users/{id})。
 */
export const getUserController = ({ params }: GetUserControllerInput) =>
  Effect.gen(function* () {
    const getUserQueryService = yield* GetUserQueryService;

    return yield* getUserQueryService
      .execute(params.id)
      .pipe(orNotFound)
      .pipe(SuccessResponse.Ok(GetUser200Response));
  });
