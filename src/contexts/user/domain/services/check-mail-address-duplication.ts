import { Effect, Option } from "effect";

import type { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import { MailAddressDuplicationError } from "~/shared/errors/mail-address-duplication-error";
import type { RepositoryError } from "~/shared/errors/repository-error";

import type { UserId } from "../model/value-objects/user-id";
import { UserRepository } from "../user-repository";

/**
 * メールアドレスの重複を検証する (ドメインサービス)。
 * 「同じメールアドレスのユーザーは 2 人存在しない」という業務ルールを担う。
 * 重複していれば MailAddressDuplicationError (errorCode 4091) で失敗する。
 *
 * User 集約 1 つを見ても「他に同じメールアドレスの人が居るか」は判断できないため、
 * 集約にも値オブジェクトにも属さない。こうした集約をまたぐ不変条件を担うのが
 * ドメインサービス。ルールに名前を与えて 1 箇所に置き、
 * 呼ぶ順序 (= ユースケースの手順) だけを command 側に残す。
 *
 * ドメインに置きつつリポジトリを読むが、依存するのは domain/ にあるポートだけで
 * 実装 (Drizzle) は知らないため、層の向きは内向きのまま保たれる。
 * I/O を伴うことは戻り値の R (UserRepository) に現れる。
 *
 * excluding には重複判定から除外するユーザーを渡す。更新時に
 * 「自分自身がヒットしただけ」を重複と誤判定しないために必要
 * (これが無いと、メールアドレスを変えない更新が常に失敗する)。
 */
export const checkMailAddressDuplication = (
  mailAddress: MailAddress,
  options: { readonly excluding?: UserId } = {},
): Effect.Effect<
  void,
  MailAddressDuplicationError | RepositoryError,
  UserRepository
> =>
  Effect.gen(function* () {
    const userRepository = yield* UserRepository;
    const user = yield* userRepository.findByMailAddress(mailAddress);

    // 除外対象本人以外の誰かが使っていれば重複。
    if (Option.isSome(user) && user.value.id !== options.excluding) {
      return yield* new MailAddressDuplicationError({ mailAddress });
    }
  });
