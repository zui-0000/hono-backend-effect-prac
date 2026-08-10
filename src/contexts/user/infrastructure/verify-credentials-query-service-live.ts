import { Effect, Layer, Option, Schema } from "effect";

import { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import { Password } from "~/shared/domain/model/value-objects/password";
import { PasswordHasher } from "~/shared/domain/password-hasher";

import { VerifyCredentialsQueryService } from "../application/verify-credentials-query-service";
import { verifyUserPassword } from "../domain/model/user";
import { UserRepository } from "../domain/user-repository";

/**
 * VerifyCredentialsQueryService の実装 (アダプタ)。
 *
 * SQL を書かず、**user コンテキストが既に持っているものを組み合わせるだけ**。
 * 集約の読み出しは UserRepository、照合は domain の verifyUserPassword が担う。
 * リポジトリを内側で使うのは構わない — 渡してはいけないのは境界の外 (auth) であって、
 * 自分のコンテキストの中で使うのは通常の経路。
 *
 * **Query なのに domain を経由する。** get-user-query-service.ts には
 * 「Query は domain を経由しない」と書いてあり、これはその例外にあたる。
 * 理由は、照合が業務ルールとして既に domain にあるから
 * (verifyUserPassword の doc — ビジネス側に「パスワード変更時に現在のパスワードを
 * 確認するか」を聞ける、という基準で内側に置いた)。
 * 経由を避けて PasswordHasher を直接叩くこともできるが、それは**同じ業務ルールを
 * 2 か所に持つ**ことになる。射影を返すという性質より、ルールを 1 つに保つほうを採った。
 *
 * 入力の形式不正 (メールアドレスとして読めない・パスワードが短すぎる) も
 * **Option.none にまとめる**。ここで 400 と 401 を書き分けると、
 * 「その形式は受け付ける = 存在しうる」という情報を与えてしまう。
 * 契約スキーマの検証は presentation が既に済ませているので、ここへ来るのは
 * 形式としては妥当な値のはず。もし通ってきたら「該当なし」で構わない。
 */
export const VerifyCredentialsQueryServiceLive = Layer.effect(
  VerifyCredentialsQueryService,
  Effect.gen(function* () {
    const userRepository = yield* UserRepository;
    const passwordHasher = yield* PasswordHasher;

    return {
      execute: ({ mailAddress, password }) =>
        Effect.gen(function* () {
          const mail = yield* Schema.decodeUnknown(MailAddress)(
            mailAddress,
          ).pipe(Effect.option);
          const plainText = yield* Schema.decodeUnknown(Password)(
            password,
          ).pipe(Effect.option);
          if (Option.isNone(mail) || Option.isNone(plainText)) {
            return Option.none();
          }

          const found = yield* userRepository.findByMailAddress(mail.value);
          if (Option.isNone(found)) {
            return Option.none();
          }

          // 一致しなければ UnauthorizedError で失敗するので、none に畳む。
          // 「居ない」と「合わない」を呼び出し側から区別させないため。
          return yield* verifyUserPassword(found.value, plainText.value)
            .pipe(Effect.as(Option.some(found.value.id)))
            .pipe(
              Effect.catchTag("UnauthorizedError", () => Effect.succeedNone),
            )
            .pipe(Effect.provideService(PasswordHasher, passwordHasher));
        }),
    };
  }),
);
