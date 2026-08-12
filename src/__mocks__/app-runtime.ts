import { Effect, Layer, ManagedRuntime, Option } from "effect";

import type { AppRuntime } from "~/app-runtime";
import { RefreshTokenIssuer } from "~/contexts/auth/domain/refresh-token-issuer";
import { RefreshTokenRepository } from "~/contexts/auth/domain/refresh-token-repository";
import { GetUserQueryService } from "~/contexts/user/application/get-user-query-service";
import { UserRepository } from "~/contexts/user/domain/user-repository";
import { VerifyCredentialsQueryService } from "~/contexts/user/public/verify-credentials-query-service";
import { AccessTokenIssuer } from "~/shared/domain/access-token-issuer";
import { PasswordHasher } from "~/shared/domain/password-hasher";
import { UuidGenerator } from "~/shared/domain/uuid-generator";

import {
  FAKE_ACCESS_TOKEN,
  FAKE_CLAIMS,
  FAKE_HASH,
  FAKE_REFRESH_TOKEN,
  FAKE_TOKEN_HASH,
  FIXED_UUID,
} from "./data";

/**
 * API テスト用のランタイム。**本番の Layer の代わりに偽の実装を束ねる。**
 *
 * `createApp` はランタイムを引数で受け取るので、これを渡すだけで
 * 「リクエスト → 契約検証 → controller → command → ドメイン → 応答」までを
 * DB を起動せず、かつ決定的 (採番と時刻が固定) に検証できる。
 *
 * **偽物にしているのはポートの実装だけ。** その内側 (handleWithEffect の契約検証、
 * decodeInput の値オブジェクト変換、ドメインの業務ルール、エラー翻訳、
 * 応答スキーマの検証) はすべて本物が動く。
 *
 * 既定はどれも「何も無い / 成功する」に寄せてある。**検証したいサービスだけ
 * ケースごとに差し替える**ことで、テストの本文に「何を試しているか」だけが残る。
 */
export const makeRuntime = (
  overrides: {
    readonly userRepository?: Partial<UserRepository["Type"]>;
    readonly getUserQueryService?: Partial<GetUserQueryService>;
    readonly passwordHasher?: Partial<PasswordHasher>;
    readonly refreshTokenRepository?: Partial<RefreshTokenRepository["Type"]>;
    readonly refreshTokenIssuer?: Partial<RefreshTokenIssuer>;
    readonly accessTokenIssuer?: Partial<AccessTokenIssuer>;
    readonly verifyCredentialsQueryService?: Partial<VerifyCredentialsQueryService>;
  } = {},
): AppRuntime =>
  ManagedRuntime.make(
    Layer.mergeAll(
      Layer.succeed(UserRepository, {
        create: () => Effect.void,
        updateProfile: () => Effect.void,
        updatePassword: () => Effect.void,
        findById: () => Effect.succeed(Option.none()),
        findByMailAddress: () => Effect.succeed(Option.none()),
        deleteById: () => Effect.void,
        ...overrides.userRepository,
      }),
      Layer.succeed(GetUserQueryService, {
        execute: () => Effect.succeed(Option.none()),
        ...overrides.getUserQueryService,
      }),
      Layer.succeed(PasswordHasher, {
        hash: () => Effect.succeed(FAKE_HASH),
        verify: () => Effect.succeed(true),
        ...overrides.passwordHasher,
      }),
      Layer.succeed(RefreshTokenRepository, {
        create: () => Effect.void,
        findByTokenHash: () => Effect.succeed(Option.none()),
        rotate: () => Effect.void,
        revokeSession: () => Effect.void,
        ...overrides.refreshTokenRepository,
      }),
      Layer.succeed(RefreshTokenIssuer, {
        issue: Effect.succeed({
          token: FAKE_REFRESH_TOKEN,
          hash: FAKE_TOKEN_HASH,
        }),
        hash: () => Effect.succeed(FAKE_TOKEN_HASH),
        ...overrides.refreshTokenIssuer,
      }),
      Layer.succeed(AccessTokenIssuer, {
        issue: () => Effect.succeed(FAKE_ACCESS_TOKEN),
        // 既定は「検証を通る」。認証の失敗経路を見るケースだけ差し替える。
        verify: () => Effect.succeed(FAKE_CLAIMS),
        ...overrides.accessTokenIssuer,
      }),
      Layer.succeed(VerifyCredentialsQueryService, {
        execute: () => Effect.succeed(Option.none()),
        ...overrides.verifyCredentialsQueryService,
      }),
      Layer.succeed(UuidGenerator, { next: Effect.succeed(FIXED_UUID) }),
    ),
  );
