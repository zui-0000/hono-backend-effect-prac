import "@typespec/http";
import "./LoginResponse.tsp";
import "./RefreshResponse.tsp";

using TypeSpec.Http;

// リフレッシュトークンの Cookie を宣言した応答。
//
// shared/response/SuccessResponses.tsp に置かないのは、**Cookie の名前が auth の語彙**
// だから。あちらは全コンテキストが使う汎用の 3 つに留める。
//
// ## なぜ応答側は @cookie ではなく @header("Set-Cookie") なのか
//
// @typespec/http 1.14.0 は **応答の @cookie に対応していない**。書くと
// response-cookie-not-supported の警告が出たうえ、**そのプロパティは黙って本文から落ちる**
// (Property 'refreshToken' will be ignored in the body)。コンパイラ自身が
// 「Set-Cookie が要るなら @header を使え」と案内するので、それに従っている。
// 要求側 (@cookie パラメータ) は対応しているので、入口と出口で書き方が非対称になる。
//
// ## 属性は契約に現れない
//
// HttpOnly / Secure / SameSite / Path / Max-Age は環境ごとに変わる運用の設定で、
// 契約が約束するのは「この応答は Set-Cookie を返す」ところまで。実際の値の組み立ては
// src/shared/presentation/constants/cookie.ts が 1 箇所で持つ。

/** ログイン成功。リフレッシュトークンは HttpOnly Cookie で返す */
model LoginSuccessResponse {
  @statusCode statusCode: 200;

  @doc("refresh_token を設定する Set-Cookie。HttpOnly のため JS からは読めない")
  @header("Set-Cookie")
  setCookie: string;

  @body body: LoginResponse;
}

/** 更新成功。ローテーションした券を Cookie で差し替える */
model RefreshSuccessResponse {
  @statusCode statusCode: 200;

  @doc("refresh_token を新しい券で上書きする Set-Cookie")
  @header("Set-Cookie")
  setCookie: string;

  @body body: RefreshResponse;
}

/** ログアウト成功。Cookie を空の値で上書きして消す */
model LogoutSuccessResponse {
  @statusCode statusCode: 204;

  @doc("refresh_token を空値・Max-Age=0 で上書きして消す Set-Cookie")
  @header("Set-Cookie")
  setCookie: string;
}
