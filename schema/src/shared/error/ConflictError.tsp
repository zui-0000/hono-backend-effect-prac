import "../model/index.tsp";
import "./ErrorCode.tsp";
import "./ErrorMessage.tsp";

@summary("ConflictError")
@doc("リソースの現在の状態と衝突する (汎用)")
@error
@example(#{ errorCode: "4090", message: "リソースの現在の状態と衝突します" })
model ConflictError {
  errorCode: ErrorCode;
  message: ErrorMessage;
}
