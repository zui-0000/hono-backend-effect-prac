import { Effect, Schema } from "effect";
import type { CookieOptions } from "hono/utils/cookie";

import { CookieSettings } from "~/shared/domain/cookie-settings";
import {
  type SuccessResponse,
  withResponseCookie,
} from "~/shared/presentation/success-response";

/**
 * リフレッシュトークンを載せる Cookie。**属性を書いてよい唯一の場所。**
 *
 * controller はここの 2 つ (`setRefreshCookie` / `clearRefreshCookie`) を呼ぶだけで、
 * 個々の属性には触れない。散らすと「ログアウトのときだけ Path を書き忘れて
 * 消えない」類の事故が起きる — 属性が 1 つでも違うと、ブラウザは**別の Cookie**
 * として扱うため、消したつもりで残る。
 */

/**
 * Cookie 名。契約の `@cookie refreshToken` が camelCase → snake_case 変換で
 * 出す名前と一致させる (`schema/src/main.tsp` の refresh)。
 */
const NAME = "refresh_token";

/**
 * 送る経路を `POST /auth/refresh` だけに絞る。
 *
 * **漏洩面を最小にするのが狙い。** 絞らないと全リクエストに 2 週間有効な券が乗り、
 * ログ・プロキシ・拡張機能など通り道すべてが漏洩点になる。
 * アクセストークンと違い、こちらは奪われると更新し放題になる。
 *
 * app.ts が auth のルータを `/auth` にマウントするので、絶対パスで書く。
 */
const PATH = "/auth/refresh";

/**
 * 券の寿命 (秒)。`docs/05-auth/01-our-approach.md`「決めた値」の 2 週間と揃える。
 *
 * **DB 側の `expires_at` とは別に持つ。** ブラウザに「いつ捨ててよいか」を
 * 伝えるためで、実際に失効を決めるのはサーバ側。片方だけ延ばすと、
 * 送られてくるが必ず 401 になる券や、まだ有効なのに消える券が生まれる。
 */
const MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

/** 契約の `RefreshToken` と同じ長さの制約 (下の doc に二重管理の経緯)。 */
const MIN_LENGTH = 20;
const MAX_LENGTH = 2048;

/**
 * 契約 (`@cookie refreshToken: RefreshToken`) に対応する入力スキーマ。
 *
 * **手書きなのは orval が Cookie パラメータを生成しないから** (実測済み。
 * ヘッダとパスパラメータは生成されるのに、Cookie だけ落ちる)。
 * OpenAPI には `in: cookie` のパラメータとして出ているので、契約側の宣言は正しく、
 * 生成が追いついていないだけ。
 *
 * 長さの制約は契約の `RefreshToken` と**同じ値を二重に持っている**。
 * 不透明トークンなので形式の検証にはほとんど意味がなく、可否は最終的に
 * ハッシュを DB に引き当てて決まる。それでも上限は残す — 無いと巨大な Cookie を
 * ハッシュ化してから捨てることになる。
 *
 * **消せる引き金は orval が Cookie パラメータを生成するようになること。**
 * そのときは生成側へ寄せて、この定義ごと消す。
 */
export const RefreshCookie = Schema.Struct({
  [NAME]: Schema.String.pipe(
    Schema.minLength(MIN_LENGTH),
    Schema.maxLength(MAX_LENGTH),
  ),
});
export type RefreshCookie = typeof RefreshCookie.Type;

/** 検証済みの Cookie から券を取り出す (キー名を controller に書かせないため)。 */
export const refreshTokenOf = (cookie: RefreshCookie): string => cookie[NAME];

/**
 * 属性を 1 箇所で組み立てる。発行と削除で**同じ関数を通す**ので、
 * `path` や `domain` がズレようがない (ズレると消えない Cookie が残る)。
 *
 * 変わるのは寿命だけ。発行なら 2 週間、削除なら 0。
 */
const cookieOptions = (
  settings: CookieSettings,
  maxAge: number,
): CookieOptions => ({
  // JS から読めないので、XSS を踏んでも券は盗まれない。Cookie へ移した理由そのもの。
  httpOnly: true,
  secure: settings.secure,
  sameSite: "Lax",
  path: PATH,
  maxAge,
  ...(settings.domain === undefined ? {} : { domain: settings.domain }),
});

/** 応答に refresh_token の Cookie を載せる (値と寿命だけを変えて共用する)。 */
const attachRefreshCookie =
  (value: string, maxAge: number) =>
  <E, R>(
    effect: Effect.Effect<SuccessResponse, E, R>,
  ): Effect.Effect<SuccessResponse, E, R | CookieSettings> =>
    Effect.gen(function* () {
      const settings = yield* CookieSettings;
      return yield* effect.pipe(
        withResponseCookie({
          name: NAME,
          value,
          options: cookieOptions(settings, maxAge),
        }),
      );
    });

/**
 * 券を Cookie に載せる。ログインと更新の両方が使う。
 *
 * 更新でも同じ関数でよいのは、**ローテーションが「同じ名前を新しい値で上書き」
 * だから**。ブラウザ側で古い券は消える。
 */
export const setRefreshCookie = (
  refreshToken: string,
): (<E, R>(
  effect: Effect.Effect<SuccessResponse, E, R>,
) => Effect.Effect<SuccessResponse, E, R | CookieSettings>) =>
  attachRefreshCookie(refreshToken, MAX_AGE_SECONDS);

/**
 * Cookie を消す (ログアウト)。
 *
 * **サーバ側でセッションを失効させるだけでは足りない。** 消さなければブラウザは
 * 2 週間送り続ける。実害は「必ず 401 になる券が飛ぶ」程度だが、失効済みの券が
 * 届き続けると**盗難検出のログがノイズで埋まる**
 * (`revoked_reason = revoked` の券は再利用検出の対象でもあるため)。
 */
export const clearRefreshCookie: <E, R>(
  effect: Effect.Effect<SuccessResponse, E, R>,
) => Effect.Effect<SuccessResponse, E, R | CookieSettings> =
  attachRefreshCookie("", 0);
