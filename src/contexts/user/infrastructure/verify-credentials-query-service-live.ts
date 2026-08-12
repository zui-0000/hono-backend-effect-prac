import { Effect, Layer, Schema } from "effect";

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
 * ここでの decode は**検証ではなく変換**。形式の検証は presentation が契約
 * (`LoginBody`) で済ませており、その制約は値オブジェクトと**同一の値**
 * (メールアドレス 255 文字・同じ正規表現、パスワード 12〜128 文字)。
 * それでも decode が要るのは、`verifyCredentials` も `findByMailAddress` も
 * branded な型を要求するから。
 *
 * ## なぜ decode の失敗を orDie にするのか
 *
 * 制約が同一である以上、presentation を通った値がここで失敗することはない。
 * **失敗したら契約と値オブジェクトがズレたということ**で、それはバグ。
 *
 * かつては `Option.none` に畳んで 401 にしていた。アカウント列挙を防ぐという
 * 理由づけだったが、形式の可否は presentation が 400 で先に教えているので
 * 隠す相手がいない。むしろ**ズレたときに静かな 401 になる**のがまずかった。
 * 正しいパスワードで入れないうえ、ログには通常の `UnauthorizedError` が出るだけで
 * 本物の認証失敗と見分けがつかない。orDie なら 500 と defect ログで鳴る。
 * どのみち利用者が入れないなら、**原因を追える方**を選ぶ。
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
        Effect.all([
          Schema.decodeUnknown(MailAddress)(mailAddress),
          Schema.decodeUnknown(Password)(password),
        ])
          .pipe(Effect.orDie)
          .pipe(
            Effect.flatMap(([mail, plainText]) =>
              verifyCredentials(mail, plainText),
            ),
          )
          .pipe(Effect.provideService(UserRepository, userRepository))
          .pipe(Effect.provideService(PasswordHasher, passwordHasher)),
    };
  }),
);
