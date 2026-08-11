import { Effect, Layer, Option, Schema } from "effect";

import { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import { Password } from "~/shared/domain/model/value-objects/password";
import { PasswordHasher } from "~/shared/domain/password-hasher";

import { VerifyCredentialsQueryService } from "../application/verify-credentials-query-service";
import { verifyCredentials } from "../domain/services/verify-credentials";
import { UserRepository } from "../domain/user-repository";

/**
 * VerifyCredentialsQueryService の実装 (アダプタ)。
 *
 * **SQL は書かない。この層で担うのは語彙の変換と配線だけ。**
 * 照合そのものはドメインサービス [`verifyCredentials`](../domain/services/verify-credentials.ts)
 * にある。
 *
 * ## 何を変換しているか
 *
 * ポートが素の `string` を受けるのは、**auth が user の語彙を持たない**から
 * (値オブジェクトへの変換は所有者である user の仕事。経緯はポートの doc)。
 * その変換を担うのがここ。外の呼び出し側の型を自分のドメインの型へ合わせる、
 * という意味で**これは正しくアダプタの仕事**にあたる。
 *
 * 形式不正 (メールアドレスとして読めない・パスワードが短すぎる) も **Option.none に
 * まとめる**。ここで 400 と 401 を書き分けると「その形式は受け付ける = 存在しうる」
 * という情報を与えてしまう。契約スキーマの検証は presentation が既に済ませているので、
 * ここへ来るのは形式としては妥当な値のはず。通ってきたら「該当なし」で構わない。
 *
 * ## なぜ provideService で注ぎ直すのか
 *
 * ポートの `execute` は `R = never` を約束している (auth に user の依存を見せないため)。
 * ドメインサービスは `UserRepository | PasswordHasher` を要求するので、
 * Layer 構築時に受け取ったものをここで埋めて `R` を閉じる。**ポートが壁である以上、
 * 壁の内側で配線し切る必要がある**という構造上の帰結。
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

          return yield* verifyCredentials(mail.value, plainText.value);
        })
          .pipe(Effect.provideService(UserRepository, userRepository))
          .pipe(Effect.provideService(PasswordHasher, passwordHasher)),
    };
  }),
);
