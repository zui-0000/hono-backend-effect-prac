import { Effect } from "effect";

import { orNotFound } from "~/shared/application/or-not-found";
import type { ForbiddenError } from "~/shared/errors/forbidden-error";
import type { RepositoryError } from "~/shared/errors/repository-error";
import type { ResourceNotFoundError } from "~/shared/errors/resource-not-found-error";

import { checkUserIsSelf } from "../domain/services/check-user-is-self";
import {
  type GetUserQueryInput,
  type GetUserQueryOutput,
  GetUserQueryService,
} from "./get-user-query-service";

/**
 * ユーザーを取得する (CQRS のクエリ)。
 *
 * 1. 対象が本人か検証 (他人なら 403。存在は見ない)
 * 2. ポートから射影を取得 (存在しなければ 404)
 *
 * なぜ controller から直接ポートを叩かないのか
 *
 * **認可はユースケースの仕事**だから。controller が `checkUserIsSelf` を呼ぶ形でも
 * 動くが、それだと規則の適用点がコマンド (application) とクエリ (presentation) で
 * 割れる。参考にした[記事](https://zenn.dev/135yshr/articles/60d7d006c0f38f)が
 * 挙げるアンチパターンの 1 つ目 (handler へ認可を埋める) の入口でもある。
 *
 * 副産物として、コマンドと呼び出しの形が揃った。controller はどちらも
 * 「DTO を組み立てて application の関数へ渡す」だけになり、
 * ポートを context から引く必要が無くなる (`Effect.gen` が消えた)。
 *
 * 1 が 2 より先である理由
 *
 * 他人の id を指定されたとき **DB を引かずに落ちる**。
 * 「認可の失敗は対象の有無に関わらず 403」という規則がそのまま順序に現れている。
 */
export const getUserQuery = (
  input: GetUserQueryInput,
): Effect.Effect<
  GetUserQueryOutput,
  ForbiddenError | ResourceNotFoundError | RepositoryError,
  GetUserQueryService
> =>
  Effect.gen(function* () {
    // 1. 本人か検証 (他人なら 403)
    yield* checkUserIsSelf(input.id, input.actor);

    // 2. 射影を取得 (存在しなければ 404)
    const getUserQueryService = yield* GetUserQueryService;
    return yield* getUserQueryService
      .execute({ id: input.id })
      .pipe(orNotFound);
  });
