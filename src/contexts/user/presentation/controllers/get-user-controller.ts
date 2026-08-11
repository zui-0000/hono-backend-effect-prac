import { Effect } from "effect";

import { GetUser200Response, type GetUserParams } from "~/generated/users";
import type { AccessTokenClaims } from "~/shared/domain/access-token-issuer";
import { decodeInput } from "~/shared/presentation/decode-input";
import { SuccessResponse } from "~/shared/presentation/success-response";

import { getUserQuery } from "../../application/get-user-query";
import { GetUserQueryInput } from "../../application/get-user-query-service";

type GetUserControllerInput = {
  auth: AccessTokenClaims;
  params: typeof GetUserParams.Type;
};

/**
 * ID を指定してユーザーを取得する (GET /users/{id})。
 */
export const getUserController = ({ auth, params }: GetUserControllerInput) =>
  decodeInput(GetUserQueryInput)({ id: params.id, actor: auth.sub })
    .pipe(Effect.flatMap(getUserQuery))
    .pipe(SuccessResponse.Ok(GetUser200Response));
