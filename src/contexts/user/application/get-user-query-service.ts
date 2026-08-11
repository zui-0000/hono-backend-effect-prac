import { Context, type Effect, type Option, Schema } from "effect";

import type { RepositoryError } from "~/shared/errors/repository-error";

import { UserId } from "../domain/model/value-objects/user-id";

/**
 * getUser クエリの入力。
 *
 * 項目が 1 つでも DTO にするのは、**ユースケースが欲しい形を宣言するのが DTO の役割**
 * だから。プリミティブを直接受けると、その役割を呼び出し側の作法に肩代わりさせることになる
 * (`execute("hello")` が型で止まらない)。コマンド側が例外なく DTO を受けているので、
 * 読み取りだけ素通しにする理由もない。
 *
 * `UserId` (ドメインの値オブジェクト) を使うのは、`VerifyCredentialsQueryService` が
 * 既に `Option<UserId>` を返しているのと同じ理由。**クエリ経路が domain を経由しない**のは
 * 集約を復元しないという意味であって、ドメインの語彙を使わないという意味ではない。
 *
 * `actor` は認可の主体 (アクセストークンの `sub`)。**照合はユースケース
 * (`getUserQuery`) が行い、ポートには渡さない。** 「引く範囲を絞る」形も検討したが、
 * それだと認可の失敗が 0 件 → 404 になり、「認可の失敗は対象の有無に関わらず 403」
 * という規則から外れる。ポートはデータの取り出しだけを担い、認可を知らない。
 */
export const GetUserQueryInput = Schema.Struct({ id: UserId, actor: UserId });
export type GetUserQueryInput = typeof GetUserQueryInput.Type;

/** ポートがデータを引くために必要な値。認可の主体は含まない。 */
export type GetUserQueryParams = { readonly id: UserId };

/**
 * getUser クエリの結果。ドメインの User 集約ではなく読み取り専用の射影で、
 * 必要になった項目だけを持たせる (集約の全項目を写さない)。
 */
export type GetUserQueryOutput = {
  readonly name: string;
  readonly mailAddress: string;
};

/**
 * ユーザー取得クエリのポート (読み取り側 / CQRS のクエリ経路)。
 *
 * ポートを domain ではなく application に置くのは、読み取りがドメインの関心事では
 * ないから。書き込みは集約の不変条件を守るため domain の UserRepository を通すが、
 * 読み取りはビジネスルールの強制が不要なので、集約を復元せず DTO を直接返す。
 *
 * 結果として依存経路も非対称になる:
 *   Command: presentation → application → domain → infrastructure
 *   Query  : presentation → application → infrastructure (domain を経由しない)
 *
 * 実装 (SQL を書く Layer) は infrastructure 層に置く。
 */
export interface GetUserQueryService {
  /**
   * id でユーザーを取得する (存在しなければ Option.none)。
   * 認可は済んでいる前提で、`actor` は受け取らない。
   */
  readonly execute: (
    params: GetUserQueryParams,
  ) => Effect.Effect<Option.Option<GetUserQueryOutput>, RepositoryError>;
}
export const GetUserQueryService = Context.GenericTag<GetUserQueryService>(
  "GetUserQueryService",
);
