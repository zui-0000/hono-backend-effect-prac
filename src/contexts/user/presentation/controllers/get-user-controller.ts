import { Effect } from "effect";

import { GetUser200Response, type GetUserParams } from "~/generated/users";
import { orNotFound } from "~/shared/application/or-not-found";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import {
  GetUserQueryInput,
  GetUserQueryService,
} from "../../application/get-user-query-service";

type GetUserControllerInput = { params: typeof GetUserParams.Type };

/**
 * ID を指定してユーザーを取得する (GET /users/{id})。
 *
 * ここだけ `Effect.gen` が残るのは、クエリのポートを context から引くため。
 * コマンド側は関数を直接呼べる (依存は Layer が注入する) ので pipe だけで済む。
 */
export const getUserController = ({ params }: GetUserControllerInput) =>
  Effect.gen(function* () {
    const input = yield* decodeInput(GetUserQueryInput)({ id: params.id });
    const getUserQueryService = yield* GetUserQueryService;

    return yield* getUserQueryService
      .execute(input)
      .pipe(orNotFound)
      .pipe(SuccessResponse.Ok(GetUser200Response));
  });
