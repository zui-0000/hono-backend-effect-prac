import { Effect, Layer } from "effect";

import { RefreshTokenIssuer } from "../domain/refresh-token-issuer";

/**
 * 券に使う乱数のバイト数。256 bit。
 * 総当たりが現実的でない量であればよく、UUID (122 bit) より厚く取っている。
 */
const TOKEN_BYTES = 32;

/**
 * 券の接頭辞。契約の例 (`rt_...`) に合わせてある。
 *
 * 秘密が漏れたときに **何の鍵かひと目で分かる**のが利点で、
 * 秘密走査 (secret scanning) の類も接頭辞を手掛かりにする。
 * 不透明トークンなので中身に意味は無いが、種類の目印だけは付ける。
 */
const TOKEN_PREFIX = "rt_";

/** バイト列を base64url にする (JSON とヘッダに安全に載る文字だけになる)。 */
const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

/**
 * 本番実装。乱数は Web Crypto、ハッシュは Bun の CryptoHasher。
 *
 * ハッシュに argon2 を使わないのは、**守るべき対象の性質が違う**から。
 * パスワードは人間が作るので推測されうる = 総当たりを遅くする必要があるが、
 * 券は 256 bit の乱数で、辞書攻撃の前提が成り立たない。SHA-256 で足りる
 * (docs/05-auth/01-our-approach.md「保存するもの」)。
 *
 * どちらも失敗しない前提なので、エラー型は never。
 */
export const RefreshTokenIssuerLive = Layer.succeed(RefreshTokenIssuer, {
  issue: Effect.sync(() => {
    const token =
      TOKEN_PREFIX +
      toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
    return {
      token,
      hash: new Bun.CryptoHasher("sha256").update(token).digest("hex"),
    };
  }),

  hash: (token) =>
    Effect.sync(() =>
      new Bun.CryptoHasher("sha256").update(token).digest("hex"),
    ),
});
