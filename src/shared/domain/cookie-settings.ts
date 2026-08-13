import { Context } from "effect";

/**
 * Cookie の属性のうち、**環境によって変わるもの**。
 *
 * `HttpOnly` / `SameSite` / `Path` / `Max-Age` は環境に依らない方針なので含めない
 * (それらは利用側が定数で持つ。auth なら
 * [`refresh-cookie.ts`](../../contexts/auth/presentation/refresh-cookie.ts))。
 * ここに置くのは**本番とローカルで値が変わる 2 つだけ**。
 *
 * ## なぜ shared/domain に置くのか
 *
 * 使うのは presentation だが、**presentation は infrastructure を参照できない**
 * (`presentation-not-to-impl` / `no-indirect-path-to-impl`)。かといって
 * `contexts/auth/domain/` にも置けない — あちらは `presentation-not-to-context-domain` が
 * 止める。**残るのが shared/domain だけ**という構造上の帰結。
 *
 * 実際 `AccessTokenIssuer` が同じ位置にいる。あれも presentation
 * ([`verify-bearer.ts`](../presentation/handler/verify-bearer.ts)) が使い、
 * 実装が `JWT_SECRET` を Config から読む。**「ポートは shared/domain、Live が Config を読む」**
 * という同じ形に乗せてある。
 *
 * ## なぜ Config を直接読まないのか
 *
 * presentation の中で `yield* Config.boolean(...)` と書けば Layer は要らない。
 * だが **Config の失敗が起動時ではなくリクエスト時になる**。
 * このリポジトリは「依存を揃えられないなら起動しない」で揃えてあるので
 * ([`docs/02-architecture.md`](../../../docs/02-architecture.md) のランタイムの節)、
 * Layer の構築時に読んで落ちる形にする。
 */
export type CookieSettings = {
  /**
   * `Secure` を付けるか。**既定は付ける** (`COOKIE_SECURE` で切る)。
   * 付けないのは `http://` のローカルだけで、そこでしか外せないようにしてある
   * — 既定を「付けない」にすると、設定を忘れた本番が平文で券を配る。
   */
  readonly secure: boolean;
  /**
   * `Domain`。未設定ならホストそのものに閉じる (サブドメインへ送らない)。
   * `api-dev1.example.com` と `app-dev1.example.com` で共有するときだけ設定する。
   */
  readonly domain: string | undefined;
};
export const CookieSettings =
  Context.GenericTag<CookieSettings>("CookieSettings");
