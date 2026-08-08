import { Effect, Schema } from "effect";

import { orNotFound } from "~/shared/application/or-not-found";
import { Password } from "~/shared/domain/model/value-objects/password";
import { PasswordHasher } from "~/shared/domain/password-hasher";
import type { RepositoryError } from "~/shared/errors/repository-error";
import type { ResourceNotFoundError } from "~/shared/errors/resource-not-found-error";
import type { UnauthorizedError } from "~/shared/errors/unauthorized-error";

import { changeUserPassword, verifyUserPassword } from "../domain/model/user";
import { UserHashedPassword } from "../domain/model/value-objects/user-hashed-password";
import { UserId } from "../domain/model/value-objects/user-id";
import { UserRepository } from "../domain/user-repository";

/**
 * パスワード変更の入力。
 * id はパスパラメータ、2 つのパスワードはボディ由来 (合成は presentation 層の責務)。
 *
 * 平文を 2 つ持つが、どちらも同じ Password (12〜128 文字) で検証する。
 * 「現在のパスワードが本当に一致するか」は値の形の話ではないのでここでは見ない
 * (ドメインの verifyUserPassword が担う)。
 */
export const ChangePasswordCommandInput = Schema.Struct({
  id: UserId,
  currentPassword: Password,
  newPassword: Password,
});
export type ChangePasswordCommandInput = typeof ChangePasswordCommandInput.Type;

/**
 * パスワードを変更する (CQRS のコマンド)。
 *
 * 1. 対象の User 集約を復元 (存在しなければ 404)
 * 2. 現在のパスワードで本人確認 (一致しなければ 401)
 * 3. 新しいパスワードをハッシュ化 (ドメインは平文を持たない)
 * 4. 集約の状態遷移 (changeUserPassword。updatedAt はドメイン側で進む)
 * 5. リポジトリへ永続化
 *
 * 2 を集約に置いた理由は verifyUserPassword の doc を参照。
 * command に残るのは「復元 → 照合 → 変更」という**順序**だけになる。
 *
 * 契約上は要認証 (Bearer) で、本人確認はその上でさらに現在のパスワードを求める
 * 二重の防御 (トークンを盗まれてもパスワードは変えられない)。
 */
export const changePasswordCommand = (
  input: ChangePasswordCommandInput,
): Effect.Effect<
  void,
  ResourceNotFoundError | UnauthorizedError | RepositoryError,
  UserRepository | PasswordHasher
> =>
  Effect.gen(function* () {
    const userRepository = yield* UserRepository;
    const passwordHasher = yield* PasswordHasher;

    // 1. 対象の集約を復元
    const user = yield* userRepository.findById(input.id).pipe(orNotFound);

    // 2. 本人確認
    yield* verifyUserPassword(user, input.currentPassword);

    // 3. 新しいパスワードをハッシュ化 (結果は必ず妥当なので decode 失敗は defect 扱い)
    const hashedPassword = yield* passwordHasher
      .hash(input.newPassword)
      .pipe(Effect.flatMap(Schema.decode(UserHashedPassword)), Effect.orDie);

    // 4. 集約の状態遷移 (元の user は書き換わらない)
    const updated = yield* changeUserPassword(user, hashedPassword);

    // 5. 永続化 (書き換わるのは hashedPassword と updatedAt だけ)
    yield* userRepository.updatePassword(updated);
  });
