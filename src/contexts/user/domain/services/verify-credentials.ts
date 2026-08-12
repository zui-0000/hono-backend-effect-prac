import { Effect, Option } from "effect";

import type { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import type { Password } from "~/shared/domain/model/value-objects/password";
import type { PasswordHasher } from "~/shared/domain/password-hasher";
import type { RepositoryError } from "~/shared/errors/repository-error";

import { verifyUserPassword } from "../model/user";
import type { UserId } from "../model/value-objects/user-id";
import { UserRepository } from "../user-repository";

/**
 * メールアドレスとパスワードの組で本人を特定する (ドメインサービス)。
 * 一致すればその利用者の id を返し、しなければ `Option.none`。
 *
 * ## なぜドメインサービスなのか
 *
 * 集約 1 つを見ても「この組み合わせが誰か」は判断できない。まず引き当てが要るためで、
 * 集約にも値オブジェクトにも属さない。リポジトリを読むが、依存するのは domain/ の
 * ポートだけなので層の向きは内向きのまま。[`checkMailAddressDuplication`](./check-mail-address-duplication.ts)
 * と同じ形 (引き当て → 判定) で、置き場も揃えてある。
 *
 * ## なぜ「居ない」と「合わない」を区別しないか
 *
 * どちらも `Option.none` に畳む。書き分けると、総当たりでメールアドレスの登録有無を
 * 判定できてしまう (アカウント列挙)。401 へ翻訳するのは呼び出し側の責務。
 *
 * ## auth との関係
 *
 * この関数を auth が直接呼ぶことはない。呼ぶと auth の `R` に
 * `UserRepository | PasswordHasher` が乗り、user の内部——とくに書き込み側の
 * `create` / `deleteById`——まで握らせることになる。auth には
 * [`VerifyCredentialsQueryService`](../../public/verify-credentials-query-service.ts)
 * というポートだけを見せ、その実装がこの関数を使う。
 */
export const verifyCredentials = (
  mailAddress: MailAddress,
  password: Password,
): Effect.Effect<
  Option.Option<UserId>,
  RepositoryError,
  UserRepository | PasswordHasher
> =>
  Effect.gen(function* () {
    const userRepository = yield* UserRepository;
    const found = yield* userRepository.findByMailAddress(mailAddress);

    if (Option.isNone(found)) {
      return Option.none();
    }

    // 一致しなければ UnauthorizedError で失敗するので、none に畳む。
    return yield* verifyUserPassword(found.value, password)
      .pipe(Effect.as(Option.some(found.value.id)))
      .pipe(Effect.catchTag("UnauthorizedError", () => Effect.succeedNone));
  });
