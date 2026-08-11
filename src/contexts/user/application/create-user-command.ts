import { Effect, Schema } from "effect";

import { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import { Password } from "~/shared/domain/model/value-objects/password";
import { PasswordHasher } from "~/shared/domain/password-hasher";
import type { UuidGenerator } from "~/shared/domain/uuid-generator";
import type { MailAddressDuplicationError } from "~/shared/errors/mail-address-duplication-error";
import type { RepositoryError } from "~/shared/errors/repository-error";

import { createUser } from "../domain/model/user";
import { UserHashedPassword } from "../domain/model/value-objects/user-hashed-password";
import type { UserId } from "../domain/model/value-objects/user-id";
import { UserName } from "../domain/model/value-objects/user-name";
import { checkMailAddressDuplication } from "../domain/services/check-mail-address-duplication";
import { UserRepository } from "../domain/user-repository";

/** ユーザー新規作成の入力。 */
export const CreateUserCommandInput = Schema.Struct({
  name: UserName,
  mailAddress: MailAddress,
  password: Password,
});
export type CreateUserCommandInput = typeof CreateUserCommandInput.Type;

/**
 * ユーザー新規作成の結果。採番された id。
 *
 * CQRS では「コマンドは値を返さない」のが原則だが、採番した識別子は例外として返す。
 * id はサーバー側でしか決まらず、返さないとクライアントは作ったリソースを
 * 二度と参照できない (GET /users/{id} を呼べない)。集約そのものは外に出さない。
 *
 * 応答ボディの `{ id: ... }` というラップは契約側の形なので、ここでは id そのものを表す。
 * 詰め替えるのは presentation の責務。
 */
export type CreateUserCommandOutput = UserId;

/**
 * ユーザーを新規作成する (CQRS のコマンド)。
 *
 * 1. メールアドレスの重複を事前チェック (UX 用。最後の砦は DB の unique 制約)
 * 2. 平文パスワードをハッシュ化 (PasswordHasher。ドメインは平文を知らない)
 * 3. User 集約を生成 (id 採番・作成/更新日時は Clock/UuidGenerator 経由)
 * 4. リポジトリへ永続化
 *
 * 失敗 (E) と依存 (R) がすべて型に現れる = throw を使わない。
 *
 * 返すのは採番された id だけ (理由は上の CreateUserCommandOutput を参照)。
 */
export const createUserCommand = (
  input: CreateUserCommandInput,
): Effect.Effect<
  CreateUserCommandOutput,
  MailAddressDuplicationError | RepositoryError,
  UserRepository | PasswordHasher | UuidGenerator
> =>
  Effect.gen(function* () {
    const userRepository = yield* UserRepository;
    const passwordHasher = yield* PasswordHasher;

    // 1. メールアドレスの重複チェック
    yield* checkMailAddressDuplication(input.mailAddress);

    // 2. パスワードをハッシュ化 (結果は必ず妥当なので decode 失敗は defect 扱い)
    const hashedPassword = yield* passwordHasher
      .hash(input.password)
      .pipe(Effect.flatMap(Schema.decode(UserHashedPassword)))
      .pipe(Effect.orDie);

    // 3. User 集約を生成
    const user = yield* createUser({
      name: input.name,
      mailAddress: input.mailAddress,
      hashedPassword,
    });

    // 4. リポジトリへ永続化
    yield* userRepository.create(user);

    return user.id;
  });
