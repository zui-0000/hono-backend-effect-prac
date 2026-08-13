import "../model/index.tsp";
import "./ErrorDetail.tsp";
import "./ErrorCode.tsp";
import "./ErrorMessage.tsp";

@summary("BadRequestError")
@doc("リクエスト内容が不正 (汎用)")
@error
@example(#{
  errorCode: "4000",
  message: "リクエスト内容が不正です",
  details: #[
    #{ field: "mailAddress", message: "メールアドレスの形式が不正です" }
  ],
})
model BadRequestError {
  errorCode: ErrorCode;
  message: ErrorMessage;
  details?: ErrorDetail[];
}
