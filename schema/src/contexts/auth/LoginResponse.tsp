import "./model/index.tsp";

// リフレッシュトークンはここに含めない。**HttpOnly Cookie で返す**
// (AuthResponses.tsp の LoginSuccessResponse が宣言している)。
// 本文に入れると JS から読めてしまい、XSS を踏んだ瞬間に 2 週間有効な券が漏れる。
@summary("LoginResponse")
model LoginResponse {
  accessToken: AccessToken;
}
