import { Effect, Option, Schema } from "effect";

import { AccessTokenIssuer } from "~/shared/domain/access-token-issuer";
import { now } from "~/shared/domain/clock";
import type { UuidGenerator } from "~/shared/domain/uuid-generator";
import type { RepositoryError } from "~/shared/errors/repository-error";
import { UnauthorizedError } from "~/shared/errors/unauthorized-error";

import {
  classifyRefreshToken,
  issueRefreshToken,
  type RefreshToken,
  RefreshTokenState,
  revokeRefreshToken,
  RevokedReason,
} from "../domain/model/refresh-token";
import { RefreshTokenHash } from "../domain/model/value-objects/refresh-token-hash";
import { RefreshTokenIssuer } from "../domain/refresh-token-issuer";
import { RefreshTokenRepository } from "../domain/refresh-token-repository";

/**
 * 更新の入力。契約の RefreshRequest と 1 対 1。
 *
 * 券に形式の制約を付けないのは、**不透明トークンだから**。
 * 中身に意味を持たせない以上、ここで検証できるのは長さくらいで、
 * それは契約スキーマ (presentation) が既に見ている。
 */
export const RefreshCommandInput = Schema.Struct({
  refreshToken: Schema.String,
});
export type RefreshCommandInput = typeof RefreshCommandInput.Type;

/** 更新の結果。差し替えた券の組を返す。 */
export type RefreshCommandOutput = {
  readonly accessToken: string;
  readonly refreshToken: string;
};

/**
 * アクセストークンを再発行する (CQRS のコマンド)。
 *
 * 1. 提示された券をハッシュ化し、記録を引く (無ければ 401)
 * 2. 状態を判定する
 * 3. 使えるなら差し替える。再利用ならセッションを切る。それ以外は 401
 *
 * **判断はドメイン、順序は command。** どの状態なら通すか・盗難をどう見分けるかは
 * classifyRefreshToken が持ち、ここに残るのは「引く → 判定 → 分岐」だけ。
 *
 * 失敗が UnauthorizedError の 1 種類なのは意図的で、「知らない券」「期限切れ」
 * 「再利用」を書き分けない。書き分けると攻撃側に手掛かりを与える。
 */
export const refreshCommand = (
  input: RefreshCommandInput,
): Effect.Effect<
  RefreshCommandOutput,
  UnauthorizedError | RepositoryError,
  | RefreshTokenRepository
  | RefreshTokenIssuer
  | AccessTokenIssuer
  | UuidGenerator
> =>
  Effect.gen(function* () {
    const repository = yield* RefreshTokenRepository;
    const refreshTokenIssuer = yield* RefreshTokenIssuer;

    // 1. 券そのものは保存していないので、ハッシュに直してから引く。
    const presentedHash = yield* refreshTokenIssuer
      .hash(input.refreshToken)
      .pipe(Effect.flatMap(Schema.decode(RefreshTokenHash)))
      .pipe(Effect.orDie);

    const stored = yield* repository.findByTokenHash(presentedHash);
    if (Option.isNone(stored)) {
      return yield* new UnauthorizedError();
    }
    const current = stored.value;

    // 2. 状態を判定する。
    const state = yield* classifyRefreshToken(current);

    // 3. 状態ごとに分岐する。**switch にして網羅を型に見張らせる** —
    //    状態が増えたときに「どれでもなければ差し替える」という書き方だと、
    //    新しい状態が黙って通ってしまう (Revoked を足したとき実際にそうなった)。
    switch (state) {
      // usable / within-grace はどちらも通常どおり差し替える。
      // 猶予期間中に「さきほど渡した券」を返せないのは、平文を保存していないため
      // (docs/05-auth/01-our-approach.md「決めた値」)。
      case RefreshTokenState.Usable:
      case RefreshTokenState.WithinGrace:
        return yield* rotate(current);

      // ローテーションで置き換えた券が猶予期間の外で使われた = 盗難のサイン。
      // そのセッションを切ってから 401。切る範囲をセッションに留めるのは、
      // 猶予期間を入れてもなお誤検出が起こりうるため (時計のずれ、遅い経路)。
      case RefreshTokenState.Reused: {
        const revokedAt = yield* now;
        yield* repository.revokeSession({
          sessionId: current.sessionId,
          revokedAt,
        });
        return yield* new UnauthorizedError();
      }

      // ログアウト / 盗難検出で既に切られている。追加の防御は要らない。
      // 期限切れも同じく、再ログインしてもらうしかない。
      case RefreshTokenState.Revoked:
      case RefreshTokenState.Expired:
        return yield* new UnauthorizedError();
    }
  });

/**
 * 券を差し替えて、新しい組を返す。
 *
 * セッションは据え置く。ここで採番し直すと、更新のたびにログアウトの単位が
 * 変わってしまい、古いタブからのログアウトが効かなくなる。
 */
const rotate = (
  current: RefreshToken,
): Effect.Effect<
  RefreshCommandOutput,
  RepositoryError,
  | RefreshTokenRepository
  | RefreshTokenIssuer
  | AccessTokenIssuer
  | UuidGenerator
> =>
  Effect.gen(function* () {
    const repository = yield* RefreshTokenRepository;
    const refreshTokenIssuer = yield* RefreshTokenIssuer;
    const accessTokenIssuer = yield* AccessTokenIssuer;

    const next = yield* refreshTokenIssuer.issue;
    const issued = yield* issueRefreshToken({
      userId: current.userId,
      sessionId: current.sessionId,
      tokenHash: yield* Schema.decode(RefreshTokenHash)(next.hash).pipe(
        Effect.orDie,
      ),
    });

    // 失効と発行は 1 つの単位。間で落ちるとクライアントは再ログインしか道が無くなる。
    yield* repository.rotate({
      revoked: yield* revokeRefreshToken(current, RevokedReason.Rotated),
      issued,
    });

    const accessToken = yield* accessTokenIssuer.issue({
      sub: current.userId,
      sid: current.sessionId,
    });

    return { accessToken, refreshToken: next.token };
  });
