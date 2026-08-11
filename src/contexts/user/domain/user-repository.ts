import { Context, type Effect, type Option } from "effect";

import type { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import type { MailAddressDuplicationError } from "~/shared/errors/mail-address-duplication-error";
import type { RepositoryError } from "~/shared/errors/repository-error";

import type { User } from "./model/user";
import type { UserId } from "./model/value-objects/user-id";

/**
 * User 集約の永続化ポート (書き込み側 / CQRS のコマンド経路)。
 * Effect のサービスとして定義 (Context.Tag)。実装 (Layer) は infrastructure 層に置く。
 * 読み取り (一覧・取得 projection) は別途 QueryService が担う。
 *
 * 更新はドメインの状態遷移と 1 対 1 に並べる (changeUserProfile → updateProfile、
 * changeUserPassword → updatePassword)。集約まるごとを書く update を 1 つ持つと、
 * **その操作が変えないはずの項目まで書き戻してしまう** — 集約を読んでから書くまでの
 * 間に他の誰かがプロフィールを変えていれば、パスワード変更がそれを巻き戻す。
 *
 * 分けた結果、失敗の型も操作ごとに正確になる。メールアドレスを書かない
 * updatePassword に一意制約違反は起こりえず、E にも現れない。
 *
 * なお同じ項目への同時更新は後勝ちのまま。検出するにはバージョン列 (楽観ロック) が
 * 要るが、項目をまたぐ不変条件が無いうちは列単位の書き分けで足りる
 * (判断の経緯は docs/04-backlog.md)。
 */
export class UserRepository extends Context.Tag("UserRepository")<
  UserRepository,
  {
    readonly create: (
      user: User,
    ) => Effect.Effect<void, MailAddressDuplicationError | RepositoryError>;
    /** 名前とメールアドレスだけを書く (changeUserProfile の結果を永続化する)。 */
    readonly updateProfile: (
      user: User,
    ) => Effect.Effect<void, MailAddressDuplicationError | RepositoryError>;
    /** ハッシュ済みパスワードだけを書く (changeUserPassword の結果を永続化する)。 */
    readonly updatePassword: (
      user: User,
    ) => Effect.Effect<void, RepositoryError>;
    readonly findById: (
      id: UserId,
    ) => Effect.Effect<Option.Option<User>, RepositoryError>;
    readonly findByMailAddress: (
      mailAddress: MailAddress,
    ) => Effect.Effect<Option.Option<User>, RepositoryError>;
    readonly deleteById: (id: UserId) => Effect.Effect<void, RepositoryError>;
  }
>() {}
