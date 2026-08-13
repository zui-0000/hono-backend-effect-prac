import { Schema } from "effect";

import type { User } from "~/contexts/user/domain/model/user";
import { UserHashedPassword } from "~/contexts/user/domain/model/value-objects/user-hashed-password";
import { UserId } from "~/contexts/user/domain/model/value-objects/user-id";
import { UserName } from "~/contexts/user/domain/model/value-objects/user-name";
import { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import { HttpHeader } from "~/shared/presentation/constants/http-header";

/**
 * テストで使う固定値と、集約のフィクスチャ。
 *
 * 偽の実装 ([`app-runtime.ts`](./app-runtime.ts)) が返す値と、
 * リクエストが送る値の両方が入る。**どちらもテスト側の資材**なので
 * カバレッジの分母からも外してある (bunfig.toml)。
 */

/** 採番を固定して、生成される id を予測可能にする。 */
export const FIXED_UUID = "019fa5bc-0000-7000-8000-000000000000";

export const REQUEST_ID = "019fa5bc-1111-7000-8000-000000000000";

/** 別人を表す id。「自分自身との重複」と「他人との重複」を区別するために使う。 */
export const OTHER_UUID = "019fa5bc-2222-7000-8000-000000000000";

/**
 * ハッシュのフィクスチャ。UserHashedPassword は PHC 形式 (`$<識別子>$...`) を
 * 要求するため、実物と同じ形にしておく必要がある
 * (平文がハッシュ欄に入る事故を型で弾くための制約)。
 */
export const EXISTING_HASH = "$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$existing";

/** 偽 PasswordHasher が返す値。実物の代わりだが形は揃える。 */
export const FAKE_HASH = "$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$fake";

/** 偽のリフレッシュトークンと、その「ハッシュ」の代わり。 */
export const FAKE_REFRESH_TOKEN = "rt_fake-refresh-token-for-tests-0123456789";
export const FAKE_TOKEN_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

/** 偽のアクセストークン。契約が 3 セグメント形式を要求するので形は揃える。 */
export const FAKE_ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";

/** 偽 AccessTokenIssuer が返す claims。sub は利用者、sid はセッション。 */
export const FAKE_CLAIMS = { sub: FIXED_UUID, sid: OTHER_UUID };

/**
 * 全リクエスト共通のヘッダ。
 *
 * Authorization を常に載せているのは、契約が `@useAuth(BearerAuth)` を宣言している
 * 4 本に要るため。認証不要な createUser でも余分なヘッダは無視されるので共通にする。
 * **認証そのものを試すケースだけ**、これを使わず自前で組み立てる。
 */
export const headers = {
  "Content-Type": "application/json",
  [HttpHeader.RequestId]: REQUEST_ID,
  [HttpHeader.Authorization]: `Bearer ${FAKE_ACCESS_TOKEN}`,
};

/**
 * リフレッシュトークンを載せる Cookie の名前。
 *
 * **実装の定数を import しない。** あちらは契約の `@cookie refreshToken` が出す名前と
 * 一致していることが要件で、テストが同じ値を独立に持つことで
 * 「名前を変えたら鳴る」状態を作る (import すると一緒に変わって気付けない)。
 */
export const REFRESH_COOKIE_NAME = "refresh_token";

/** 券を Cookie に載せたリクエストヘッダ。refresh はこれで券を送る。 */
export const withRefreshCookie = (
  refreshToken: string,
): Record<string, string> => ({
  ...headers,
  Cookie: `${REFRESH_COOKIE_NAME}=${refreshToken}`,
});

/** 応答の Set-Cookie をそのまま取り出す (無ければ null)。 */
export const setCookieOf = (response: Response): string | null =>
  response.headers.get("set-cookie");

/** Set-Cookie に載っている値だけを取り出す (属性は見ない)。 */
export const cookieValueOf = (response: Response): string | undefined =>
  setCookieOf(response)?.split(";")[0]?.replace(`${REFRESH_COOKIE_NAME}=`, "");

/** 既に永続化されている User 集約。作成/更新日時は 0 に固定して差分を見やすくする。 */
export const makeUser = (
  params: { readonly id?: string; readonly mailAddress?: string } = {},
): User => ({
  id: Schema.decodeSync(UserId)(params.id ?? FIXED_UUID),
  name: Schema.decodeSync(UserName)("既存ユーザー"),
  mailAddress: Schema.decodeSync(MailAddress)(
    params.mailAddress ?? "existing@example.com",
  ),
  hashedPassword: Schema.decodeSync(UserHashedPassword)(EXISTING_HASH),
  createdAt: new Date(0),
  updatedAt: new Date(0),
});
