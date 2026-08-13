import "../model/index.tsp";

@summary("InternalServerError")
@doc("サーバー内部で予期せぬエラーが発生した (汎用)")
@error
@example(#{
  errorCode: "5000",
  message: "サーバーで予期せぬエラーが発生しました",
})
model InternalServerError {
  errorCode: ErrorCode;
  message: ErrorMessage;
}
