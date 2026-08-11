/**
 * 共通基盤が返すエラーメッセージ。
 *
 * `ErrorCode` / `HttpStatus` と並ぶ「API が外に見せるもの」の 3 つ目。
 * 文言をここに集めるのは、同じ状況に別の言い回しが生まれるのを防ぐため
 * (エンドポイントごとに微妙に違う 400 のメッセージが増えると、
 * クライアント側で文言を頼りにした分岐が壊れる)。
 *
 * 文言は対応する errorCode と同じ粒度にする。汎用エラー (ResourceNotFound など) に
 * 「ユーザーが見つかりません」のような固有の文言を持たせない — 汎用と言いながら
 * 中身が固有だと、コンテキストごとに文言を抱えることになる。
 * 固有の説明が要るなら、まず契約 (TypeSpec) に固有の errorCode を足す
 * (Conflict "4090" に対する MailAddressDuplication "4091" と同じやり方)。
 *
 * 内部で何が起きたかは logFailure がサーバーログに残すので、ここは
 * 外部に見せてよい定型文だけにする (原因は露出させない)。
 */
export const ErrorMessage = {
  /** 400 リクエストが契約を満たさない (違反フィールドは details に入る) */
  BadRequest: "リクエスト内容が不正です",
  /** 400 リクエストボディが JSON として読めない */
  MalformedJson: "リクエストボディを JSON として解釈できません",
  /** 401 認証に失敗した (どこで失敗したかは書き分けない) */
  Unauthorized: "認証情報が正しくありません",
  /** 404 指定されたリソースが存在しない (汎用) */
  Forbidden: "この操作を行う権限がありません",
  NotFound: "指定されたリソースは存在しません",
  /** 409 メールアドレスの重複 */
  MailAddressDuplication: "メールアドレスが既に使用されています",
  /** 500 想定外の失敗 (原因はログにのみ残す) */
  InternalServerError: "サーバーで予期せぬエラーが発生しました",
} as const;

export type ErrorMessage = (typeof ErrorMessage)[keyof typeof ErrorMessage];
