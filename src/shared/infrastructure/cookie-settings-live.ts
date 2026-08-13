import { Config, Effect, Layer, Option } from "effect";

import { CookieSettings } from "~/shared/domain/cookie-settings";

/**
 * CookieSettings の本番実装 (アダプタ)。
 *
 * `AccessTokenIssuerLive` と同じく **Layer の構築時に Config を読む**ので、
 * 値が壊れていれば起動時に落ちる (リクエストを受けてからではない)。
 *
 * `COOKIE_SECURE` の既定を `true` にしてあるのが要点。**設定を忘れた環境が
 * 安全側に倒れる**ようにするため。逆にすると、本番で付け忘れたときに
 * 平文の経路でも券が送られ、しかも何も壊れないので気付けない。
 * 外すのは `http://` のローカルだけで、そこは明示的に `COOKIE_SECURE=false` と書く。
 *
 * `COOKIE_DOMAIN` は未設定を許す。無ければブラウザは**発行したホストだけ**に
 * 送るようになり、いちばん狭い。サブドメインで共有する構成になったときだけ設定する。
 */
export const CookieSettingsLive = Layer.effect(
  CookieSettings,
  Effect.gen(function* () {
    const secure = yield* Config.boolean("COOKIE_SECURE").pipe(
      Config.withDefault(true),
    );
    const domain = yield* Config.string("COOKIE_DOMAIN").pipe(Config.option);

    return { secure, domain: Option.getOrUndefined(domain) };
  })
    // 既定があるので「未設定」では落ちない。落ちるのは COOKIE_SECURE に
    // 真偽値として読めない値が入っているときで、それは設定のバグ。
    // DatabaseLive / AccessTokenIssuerLive と同じく、依存を揃えられないなら
    // 起動しないのが正しいので defect にする。
    .pipe(Effect.orDie),
);
