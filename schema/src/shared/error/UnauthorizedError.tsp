import "../model/index.tsp";
import "./ErrorCode.tsp";
import "./ErrorMessage.tsp";

@summary("UnauthorizedError")
@doc("認証情報が不正 (汎用)")
@error
@example(#{ errorCode: "4010", message: "認証情報が正しくありません" })
model UnauthorizedError {
  errorCode: ErrorCode;
  message: ErrorMessage;
}
