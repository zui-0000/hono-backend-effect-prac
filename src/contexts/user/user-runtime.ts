import type { ManagedRuntime } from "effect";

import type { AccessTokenIssuer } from "~/shared/domain/access-token-issuer";
import type { PasswordHasher } from "~/shared/domain/password-hasher";
import type { UuidGenerator } from "~/shared/domain/uuid-generator";

import type { GetUserQueryService } from "./application/get-user-query-service";
import type { UserRepository } from "./domain/user-repository";

/**
 * user コンテキストを動かすのに必要なサービス (要求側の宣言)。
 *
 * 提供側の [`user-layer.ts`](./user-layer.ts) とは **必ずファイルを分ける**。
 * あちらは infrastructure を import するため、同居させるとこの型を 1 つ参照した
 * だけで実装への経路が通ってしまう (dependency-cruiser の
 * `no-indirect-path-to-impl` が検出する)。ここが import してよいのはポートだけ。
 *
 * `~/app-runtime` の AppRuntime を使わないのも同じ理由。あれは合成ルートで
 * 全コンテキストの infrastructure を知っている。
 *
 * 列挙は手書きだが、足りなければ利用側 (user-routes.ts) でコンパイルエラーになる。
 * 明示しておくことで「このコンテキストは何を要求するか」が名前で読める。
 * AppRuntime はこれより多くを提供するので、そのまま渡せる。
 */
export type UserRuntime = ManagedRuntime.ManagedRuntime<
  | UserRepository
  | GetUserQueryService
  | PasswordHasher
  // Bearer の検証は handleWithEffect が行うため、認証を要求するエンドポイントが
  // 1 本でもあるコンテキストはこれを要求する。
  | AccessTokenIssuer
  | UuidGenerator,
  never
>;
