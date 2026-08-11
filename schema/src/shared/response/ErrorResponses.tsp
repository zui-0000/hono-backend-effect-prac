import "@typespec/http";
import "../error/index.tsp";

using TypeSpec.Http;

/** リクエスト内容が不正 (汎用) */
model BadRequestErrorResponse {
  @statusCode statusCode: 400;
  @body error: BadRequestError;
}

/** 認証情報が不正 (汎用) */
model UnauthorizedErrorResponse {
  @statusCode statusCode: 401;
  @body error: UnauthorizedError;
}

/** 操作する権限が無い (汎用) */
model ForbiddenErrorResponse {
  @statusCode statusCode: 403;
  @body error: ForbiddenError;
}

/** リソースが見つからない (汎用) */
model NotFoundErrorResponse {
  @statusCode statusCode: 404;
  @body error: ResourceNotFoundError;
}

/** リソースの現在の状態と衝突する (汎用) */
model ConflictErrorResponse {
  @statusCode statusCode: 409;
  @body error: ConflictError;
}

/** メールアドレスが既に使用されている */
model MailAddressAlreadyExistsErrorResponse {
  @statusCode statusCode: 409;
  @body error: MailAddressAlreadyExistsError;
}

/** サーバーエラー (汎用) */
model InternalServerErrorResponse {
  @statusCode statusCode: 500;
  @body error: InternalServerError;
}
