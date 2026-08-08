/**
 * API が読み書きする HTTP ヘッダ名。
 *
 * 契約 (schema/src/shared/header/CommonHeaders.tsp) と対になる。
 * ヘッダ名の文字列を各所に直書きすると、綴りのゆらぎ (X-Request-ID と
 * X-Request-Id など) が実行時まで表面化しないため 1 箇所に集める。
 *
 * request-header ではなく http-header としているのは、相関 ID が
 * リクエストで受け取り応答にも付けるヘッダで、どちらか一方ではないため。
 */
export const HttpHeader = {
  /** 相関 ID。リクエストから引き継ぎ、応答にも付与する。 */
  RequestId: "X-Request-Id",
  /** アクセストークンの運び先。契約の `@useAuth(BearerAuth)` と対になる。 */
  Authorization: "Authorization",
} as const;

export type HttpHeader = (typeof HttpHeader)[keyof typeof HttpHeader];
