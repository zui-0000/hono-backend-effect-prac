import { Effect, Schema } from "effect";

import { VerifyCredentialsQueryService } from "~/contexts/user/public/verify-credentials-query-service";
import { orUnauthorized } from "~/shared/application/or-unauthorized";
import { AccessTokenIssuer } from "~/shared/domain/access-token-issuer";
import type { UuidGenerator } from "~/shared/domain/uuid-generator";
import type { RepositoryError } from "~/shared/errors/repository-error";
import type { UnauthorizedError } from "~/shared/errors/unauthorized-error";

import { issueRefreshToken } from "../domain/model/refresh-token";
import { RefreshTokenHash } from "../domain/model/value-objects/refresh-token-hash";
import { generateSessionId } from "../domain/model/value-objects/session-id";
import { RefreshTokenIssuer } from "../domain/refresh-token-issuer";
import { RefreshTokenRepository } from "../domain/refresh-token-repository";

/**
 * ログインの入力。契約の LoginRequest と 1 対 1。
 *
 * 値オブジェクトへ変換しないのは、**照合するのが user 側**だから。
 * auth はメールアドレスの形式もパスワードの長さも判断しない
 * (どちらも user が所有する語彙で、形式の検証は契約スキーマが既に済ませている)。
 */
export const LoginCommandInput = Schema.Struct({
  mailAddress: Schema.String,
  password: Schema.String,
});
export type LoginCommandInput = typeof LoginCommandInput.Type;

/** ログインの結果。発行した券の組。 */
export type LoginCommandOutput = {
  readonly accessToken: string;
  readonly refreshToken: string;
};

/**
 * メールアドレスとパスワードで券を発行する (CQRS のコマンド)。
 *
 * 1. user に照合を頼む (一致しなければ 401)
 * 2. セッションを採番し、リフレッシュトークンを発行して記録する
 * 3. アクセストークンを署名して、両方を返す
 *
 * **初のコンテキスト跨ぎ。** user が公開している VerifyCredentialsQueryService
 * だけを使い、UserRepository には触れない。あれは書き込み側のポートで、
 * 渡すと create / deleteById まで握ることになる。
 * 境界ルールは domain の参照を許すので**止めてくれない** — ここは人間が守る。
 *
 * 1 でセッションを新規に採番するのが refresh との違い。あちらは据え置く
 * (据え置かないと更新のたびにログアウトの単位が変わる)。
 */
export const loginCommand = (
  input: LoginCommandInput,
): Effect.Effect<
  LoginCommandOutput,
  UnauthorizedError | RepositoryError,
  | VerifyCredentialsQueryService
  | RefreshTokenRepository
  | RefreshTokenIssuer
  | AccessTokenIssuer
  | UuidGenerator
> =>
  Effect.gen(function* () {
    const verifyCredentials = yield* VerifyCredentialsQueryService;
    const refreshTokenRepository = yield* RefreshTokenRepository;
    const refreshTokenIssuer = yield* RefreshTokenIssuer;
    const accessTokenIssuer = yield* AccessTokenIssuer;

    // 1. 照合。「居ない」と「合わない」は user 側で既に畳まれているので、
    //    畳まれたまま 401 へ翻訳する。
    const userId = yield* verifyCredentials.execute(input).pipe(orUnauthorized);

    // 2. ログインごとに新しいセッション。1 セッション = 1 デバイスの単位になる。
    const sessionId = yield* generateSessionId;
    const issued = yield* refreshTokenIssuer.issue;
    yield* refreshTokenRepository.create(
      yield* issueRefreshToken({
        userId,
        sessionId,
        tokenHash: yield* Schema.decode(RefreshTokenHash)(issued.hash).pipe(
          Effect.orDie,
        ),
      }),
    );

    // 3. 券の組を返す。sid にセッションを載せるので、ログアウトはこの単位で効く。
    const accessToken = yield* accessTokenIssuer.issue({
      sub: userId,
      sid: sessionId,
    });

    return { accessToken, refreshToken: issued.token };
  });
