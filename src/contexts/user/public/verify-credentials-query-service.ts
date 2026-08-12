import { Context, type Effect, type Option } from "effect";

import type { RepositoryError } from "~/shared/errors/repository-error";

import type { UserId } from "../domain/model/value-objects/user-id";

/**
 * 認証情報の照合クエリのポート (読み取り側 / CQRS のクエリ経路)。
 *
 * **auth コンテキストの求めに応じて user が公開している面**。
 * DDD の Customer/Supplier で、使う側 (auth) の要求を供給側 (user) が受けて公開する。
 * このリポジトリで初めてコンテキストを跨ぐ参照になる。
 *
 * ### なぜ UserRepository を使わせないか
 *
 * `UserRepository.findByMailAddress` は必要な情報を返すが、あれは書き込み側のポートで、
 * 渡すと `create` / `updateProfile` / `deleteById` まで一緒に握らせることになり、
 * 「書き込みは所有コンテキストの command を通す」が崩れる。
 *
 * かつてはこの越境を境界ルールが止められず、doc で「人間が止める」と宣言していた。
 * 2026-08-12 に `cross-context-public-only` を allowlist へ反転させ、
 * **他コンテキストから見えるのは `public/` と値オブジェクトだけ**にしたので、
 * いまは機械が止める。このファイルが `public/` に居るのはそのため。
 *
 * ### なぜハッシュを返さないか
 *
 * 「このパスワードで合っているか」は user の業務ルールで、実際
 * `verifyUserPassword` が domain にある (ビジネス側に「パスワード変更のとき
 * 現在のパスワードを確認するか」を聞ける、という理由で内側に置いた)。
 * ハッシュを渡して auth に照合させると、**同じ業務ルールを 2 か所に持つ**ことになる。
 *
 * 副産物として、ハッシュが境界を越えず、auth は PasswordHasher を要求しなくなる。
 * auth が知るべきは「券をどう作るか」だけで、「パスワードをどう照合するか」ではない。
 *
 * ### なぜ失敗を区別しないか
 *
 * 「利用者が居ない」と「パスワードが違う」を **どちらも Option.none にまとめる**。
 * 書き分けると、総当たりでメールアドレスの登録有無を判定できてしまう
 * (アカウント列挙)。401 へ翻訳するのは呼び出し側 (auth) の責務。
 *
 * ### なぜ id だけ branded なまま返すか
 *
 * 入力は素の string を受けるのに、返す id は branded な UserId。非対称に見えるが、
 * **使われ方が違う**。入力は「照合してもらう材料」で、値オブジェクトへの変換は
 * 所有者である user の仕事。一方 id は auth 側で **RefreshToken 集約の項目になる**
 * (あちらの userId は UserId 型)。素の string で返すと、自分の DB から出したばかりの
 * 値を境界の向こうで検証し直すという無駄が生まれる。
 *
 * GetUserQueryOutput が素の string なのは、あれが HTTP 応答へ直行して
 * ドメインの値として使われないため。**射影だから常に素、ではなく、
 * 渡した先で何になるかで決める。**
 */
export interface VerifyCredentialsQueryService {
  /** 一致すればその利用者の id を返す。一致しない・居ない場合は Option.none。 */
  readonly execute: (params: {
    readonly mailAddress: string;
    readonly password: string;
  }) => Effect.Effect<Option.Option<UserId>, RepositoryError>;
}
export const VerifyCredentialsQueryService =
  Context.GenericTag<VerifyCredentialsQueryService>(
    "VerifyCredentialsQueryService",
  );
