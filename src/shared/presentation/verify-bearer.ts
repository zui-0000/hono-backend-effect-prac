import { Effect } from "effect";
import type { Context } from "hono";

import {
  type AccessTokenClaims,
  AccessTokenIssuer,
} from "~/shared/domain/access-token-issuer";
import { UnauthorizedError } from "~/shared/errors/unauthorized-error";

import { HttpHeader } from "./constants/http-header";

/** `Authorization: Bearer <token>` から券だけを取り出す。 */
const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * `Authorization` ヘッダのアクセストークンを検証し、claims を取り出す。
 *
 * 呼ぶのは handleWithEffect だけ。routes が `auth: true` を宣言したときに走り、
 * 検証済みの claims が controller の入力に載る
 * (validateJson などの入力源ごとの検証と同じ立ち位置)。
 *
 * **Hono のミドルウェアにしていない。** `app.use("/users/*", ...)` の形にすると、
 * 契約 (`@useAuth(BearerAuth)`) とパスの対応を人間が二重に管理することになり、
 * 付け忘れても何も起きない。routes の宣言に混ぜておけば、
 * **認証の要否がエンドポイントの他の宣言と同じ場所で読める**。
 *
 * 失敗はすべて UnauthorizedError の 1 種類。ヘッダが無い・形式が違う・署名が不正・
 * 期限切れを書き分けない (攻撃側に手掛かりを与えないため)。
 * 401 は契約でも宣言済みなので、応答の形は変わらない。
 */
export const verifyBearer = (
  c: Context,
): Effect.Effect<AccessTokenClaims, UnauthorizedError, AccessTokenIssuer> =>
  Effect.gen(function* () {
    const header = c.req.header(HttpHeader.Authorization);
    const token = header?.match(BEARER_PATTERN)?.[1];
    if (token === undefined) {
      return yield* new UnauthorizedError();
    }

    const issuer = yield* AccessTokenIssuer;
    return yield* issuer.verify(token);
  });
