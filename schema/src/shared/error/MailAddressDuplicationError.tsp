import "../model/index.tsp";
import "./ErrorCode.tsp";
import "./ErrorMessage.tsp";

@summary("MailAddressDuplicationError")
@doc("メールアドレスが既に使用されている")
@error
@example(#{ errorCode: "4091", message: "MailAddressDuplicationError" })
model MailAddressDuplicationError {
  errorCode: ErrorCode;
  message: ErrorMessage;
}
