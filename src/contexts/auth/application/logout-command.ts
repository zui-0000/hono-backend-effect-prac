import { Effect, Schema } from "effect";

import { now } from "~/shared/domain/clock";
import type { RepositoryError } from "~/shared/errors/repository-error";

import { SessionId } from "../domain/model/value-objects/session-id";
import { RefreshTokenRepository } from "../domain/refresh-token-repository";

/**
 * ログアウトの入力。**アクセストークンの sid だけ。**
 *
 * 契約の logout はボディを持たない (`op logout(...CommonHeaders)`) ので、
 * どのセッションを切るかは Bearer から取るしかない。
 * その sid は handleWithEffect が署名を検証したうえで渡してくる。
 */
export const LogoutCommandInput = Schema.Struct({
  sessionId: SessionId,
});
export type LogoutCommandInput = typeof LogoutCommandInput.Type;

/**
 * セッションを終了する (CQRS のコマンド)。
 *
 * 切る単位が**セッション**であって券 1 枚でないのは、ローテーションで行が
 * 増えるため。session_id をローテーションを跨いで据え置いてあるので、
 * どのタブから叩いても同じセッションが落ちる
 * (docs/05-auth/01-our-approach.md「session_id を別に持つ理由」)。
 *
 * 失効の理由は revoked_at と別に記録され、猶予期間の対象にならない。
 * ここを取り違えると**ログアウトが 30 秒間効かない**
 * (同 doc「猶予期間は『失効の理由』で判定する」)。
 *
 * アクセストークンは失効させられない (JWT なので DB を見ない)。
 * 最大でその寿命ぶん (15 分) は通り続けるが、これは受け入れている代償。
 *
 * 該当するセッションが無くても成功として扱う。**冪等**にしておくと、
 * 二重送信やリトライで 404 を返さずに済む。契約も 204 だけを宣言している。
 */
export const logoutCommand = (
  input: LogoutCommandInput,
): Effect.Effect<void, RepositoryError, RefreshTokenRepository> =>
  Effect.gen(function* () {
    const refreshTokenRepository = yield* RefreshTokenRepository;

    yield* refreshTokenRepository.revokeSession({
      sessionId: input.sessionId,
      revokedAt: yield* now,
    });
  });
