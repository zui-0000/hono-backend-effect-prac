import { Effect, Schema } from "effect";

import { orNotFound } from "~/shared/application/or-not-found";
import type { ForbiddenError } from "~/shared/errors/forbidden-error";
import type { RepositoryError } from "~/shared/errors/repository-error";
import type { ResourceNotFoundError } from "~/shared/errors/resource-not-found-error";

import { UserId } from "../domain/model/value-objects/user-id";
import { checkUserIsSelf } from "../domain/services/check-user-is-self";
import { UserRepository } from "../domain/user-repository";

/**
 * ユーザー削除の入力。項目が id だけでも Struct で定義するのは、
 * 生成スキーマの UserId (API 契約の brand) をドメインの UserId へ
 * 変換する経路を、他のコマンドと同じ形に揃えるため。
 */
export const DeleteUserCommandInput = Schema.Struct({
  id: UserId,
  actor: UserId,
});
export type DeleteUserCommandInput = typeof DeleteUserCommandInput.Type;

/**
 * ユーザーを削除する (CQRS のコマンド)。
 *
 * 1. 対象が本人か検証 (他人なら 404。存在も漏らさない)
 * 2. 対象の存在確認 (存在しなければ 404)
 * 3. リポジトリから削除
 *
 * 削除前に存在確認するのは、API 契約が 404 を返すと定めているから。
 * ポートの deleteById は「その ID の行が無い状態」だけを保証し、
 * 何件消したかは返さない (影響行数は DB 都合の概念なので、
 * ドメインのポートには持ち込まない)。そのため存在判定は別クエリで行う。
 *
 * 集約を復元しても遷移させないため、User を受け取らず存在確認だけに使う。
 * 削除はドメインの不変条件を持たない操作なので、ドメインに関数を足す必要もない。
 */
export const deleteUserCommand = (
  input: DeleteUserCommandInput,
): Effect.Effect<
  void,
  ForbiddenError | ResourceNotFoundError | RepositoryError,
  UserRepository
> =>
  Effect.gen(function* () {
    const userRepository = yield* UserRepository;

    // 1. 本人か検証 (他人なら 404)
    yield* checkUserIsSelf(input.id, input.actor);

    // 2. 存在確認 (復元した集約は使わず、居ることだけを確かめる)
    yield* userRepository.findById(input.id).pipe(orNotFound);

    // 3. 削除
    yield* userRepository.deleteById(input.id);
  });
