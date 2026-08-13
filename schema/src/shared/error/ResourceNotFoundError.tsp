import "../model/index.tsp";
import "./ErrorCode.tsp";
import "./ErrorMessage.tsp";

@summary("ResourceNotFoundError")
@doc("リソースが存在しない (汎用)")
@error
@example(#{ errorCode: "4040", message: "指定されたリソースは存在しません" })
model ResourceNotFoundError {
  errorCode: ErrorCode;
  message: ErrorMessage;
}
