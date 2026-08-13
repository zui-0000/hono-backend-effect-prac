import type { ManagedRuntime } from "effect";

import type { VerifyCredentialsQueryService } from "~/contexts/user/public/verify-credentials-query-service";
import type { AccessTokenIssuer } from "~/shared/domain/access-token-issuer";
import type { CookieSettings } from "~/shared/domain/cookie-settings";
import type { UuidGenerator } from "~/shared/domain/uuid-generator";

import type { RefreshTokenIssuer } from "./domain/refresh-token-issuer";
import type { RefreshTokenRepository } from "./domain/refresh-token-repository";

/**
 * auth コンテキストを動かすのに必要なサービス (要求側の宣言)。
 *
 * 提供側の [`auth-layer.ts`](./auth-layer.ts) とは **必ずファイルを分ける**。
 * あちらは infrastructure を import するため、同居させるとこの型を 1 つ参照した
 * だけで実装への経路が通ってしまう (`no-indirect-path-to-impl` が検出する)。
 * ここが import してよいのはポートだけ。
 */
export type AuthRuntime = ManagedRuntime.ManagedRuntime<
  | RefreshTokenRepository
  | RefreshTokenIssuer
  | AccessTokenIssuer
  | VerifyCredentialsQueryService
  // 券を HttpOnly Cookie で受け渡すため。user 側は要求しない
  // (Cookie を出す経路が auth にしか無い)。
  | CookieSettings
  | UuidGenerator,
  never
>;
