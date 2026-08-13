import "../model/index.tsp";
import "./ErrorCode.tsp";
import "./ErrorMessage.tsp";

@summary("MailAddressDuplicationError")
@doc("メールアドレスが既に使用されている")
@error
@example(#{
  errorCode: "4091",
  message: "メールアドレスが既に使用されています",
})
model MailAddressDuplicationError {
  errorCode: ErrorCode;
  message: ErrorMessage;
}
