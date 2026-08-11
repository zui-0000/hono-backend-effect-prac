import { Effect, Schema } from "effect";

import { orNotFound } from "~/shared/application/or-not-found";
import { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import { ForbiddenError } from "~/shared/errors/forbidden-error";
import type { MailAddressAlreadyExistsError } from "~/shared/errors/mail-address-already-exists-error";
import type { RepositoryError } from "~/shared/errors/repository-error";
import type { ResourceNotFoundError } from "~/shared/errors/resource-not-found-error";

import { changeUserProfile } from "../domain/model/user";
import { UserId } from "../domain/model/value-objects/user-id";
import { UserName } from "../domain/model/value-objects/user-name";
import { checkMailAddressDuplication } from "../domain/services/check-mail-address-duplication";
import { checkUserIsSelf } from "../domain/services/check-user-is-self";
import { UserRepository } from "../domain/user-repository";

/**
 * ユーザー更新の入力。
 */
export const UpdateUserCommandInput = Schema.Struct({
  id: UserId,
  actor: UserId,
  name: UserName,
  mailAddress: MailAddress,
});
export type UpdateUserCommandInput = typeof UpdateUserCommandInput.Type;

/**
 * ユーザーのプロフィールを更新する (CQRS のコマンド)。
 *
 * 1. 対象が本人か検証 (他人なら 404。存在も漏らさない)
 * 2. 対象の User 集約を復元 (存在しなければ 404)
 * 3. メールアドレスの重複を事前チェック (UX 用。最後の砦は DB の unique 制約)
 * 4. 集約の状態遷移 (User.changeProfile。updatedAt はドメイン側で進む)
 * 5. リポジトリへ永続化
 *
 * 1 を復元より先に置くのは、他人の id を指定されたとき **DB を引かずに済む**から。
 * 存在確認より先に落ちるので、応答時間から実在を推測される余地も減る。
 *
 * 作成 (createUserCommand) との違いは 1 の「復元」があること。
 * 更新は既存の状態を前提とする操作なので、集約を読み出してから遷移させる。
 * ここで復元を挟むから「存在しない ID への更新」を 404 として表現できる。
 */
export const updateUserCommand = (
  input: UpdateUserCommandInput,
): Effect.Effect<
  void,
  | ForbiddenError
  | ResourceNotFoundError
  | MailAddressAlreadyExistsError
  | RepositoryError,
  UserRepository
> =>
  Effect.gen(function* () {
    const userRepository = yield* UserRepository;

    // 1. 本人か検証 (他人なら 404)
    yield* checkUserIsSelf(input.id, input.actor);

    // 2. 対象の集約を復元 (存在しなければ 404)
    const user = yield* userRepository.findById(input.id).pipe(orNotFound);

    // 3. メールアドレスの重複チェック。
    //    自分自身を除外しないと「メールアドレスを変えない更新」が 409 になる。
    yield* checkMailAddressDuplication(input.mailAddress, {
      excluding: user.id,
    });

    // 3. 集約の状態遷移 (元の user は書き換わらない)
    const updated = yield* changeUserProfile(user, {
      name: input.name,
      mailAddress: input.mailAddress,
    });

    // 4. リポジトリへ永続化 (書き換わるのは name / mailAddress と updatedAt だけ)
    yield* userRepository.updateProfile(updated);
  });
