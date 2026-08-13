import "./model/index.tsp";

// ローテーション (更新のたびに券ごと差し替える) した新しい券は、本文ではなく
// **Set-Cookie で返す** (AuthResponses.tsp の RefreshSuccessResponse)。
// クライアントは何もしなくてよい — ブラウザが自動で差し替える。
@summary("RefreshResponse")
model RefreshResponse {
  accessToken: AccessToken;
}
