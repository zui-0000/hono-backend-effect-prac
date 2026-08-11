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
 */
export const GetUserQueryInput = Schema.Struct({ id: UserId });
export type GetUserQueryInput = typeof GetUserQueryInput.Type;

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
  /** id でユーザーを取得する (存在しなければ Option.none)。 */
  readonly execute: (
    input: GetUserQueryInput,
  ) => Effect.Effect<Option.Option<GetUserQueryOutput>, RepositoryError>;
}
export const GetUserQueryService = Context.GenericTag<GetUserQueryService>(
  "GetUserQueryService",
);
