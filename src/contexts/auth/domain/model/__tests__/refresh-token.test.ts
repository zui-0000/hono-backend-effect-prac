import { describe, expect, test } from "bun:test";

import { Effect, Option, Schema, TestClock, TestContext } from "effect";

import {
  classifyRefreshToken,
  RefreshToken,
  RefreshTokenState,
  RevokedReason,
} from "../refresh-token";

/**
 * 券の状態判定の単体テスト。
 *
 * **時計を固定して実行する。** 猶予期間の境界 (30 秒ちょうど) は実時計では測れない
 * — 券を組み立ててから判定が走るまでの数ミリ秒で結果が変わってしまう。
 * `shared/domain/clock.ts` を Effect の Clock 経由にしてあるのは、まさにこのため。
 *
 * ここが壊れると、猶予期間が効かず並行更新で正規利用者を締め出すか、
 * 逆に失効した券を通してしまう。**どちらも 200 系が返るので気付きにくい**。
 */

/** 判定の基準時刻。ここを軸に相対で券を組み立てる。 */
const NOW = 1_786_150_000_000;

/** 基準時刻からの相対で Date を作る。 */
const at = (offsetMillis: number): Date => new Date(NOW + offsetMillis);

/**
 * 券を組み立てる。**行の形 (Encoded) から decode している**ので、
 * DB の行がそのまま集約になることも同時に確かめていることになる。
 */
const makeToken = (over: {
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: RevokedReason | null;
}): RefreshToken =>
  Schema.decodeUnknownSync(RefreshToken)({
    id: "019fde14-54da-7000-85b3-d7e794ca99f6",
    sessionId: "019fde14-0000-7000-85b3-d7e794ca99f6",
    tokenHash:
      "cd8b6e9afea1a9785b564205786fdea3a0d06a49ad0f1db4c7cf945de8730cfc",
    userId: "019fddf6-e083-7000-afb0-55af9d7f62e2",
    createdAt: new Date(NOW),
    ...over,
  });

/** 時計を NOW に固定して判定する。 */
const classifyAtNow = (token: RefreshToken): Promise<RefreshTokenState> =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      return yield* classifyRefreshToken(token);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );

describe("classifyRefreshToken", () => {
  test("未失効・期限内なら usable", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: null,
      revokedReason: null,
    });

    expect(await classifyAtNow(token)).toBe(RefreshTokenState.Usable);
  });

  test("ローテーション済みでも猶予期間の内なら within-grace", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-5_000),
      revokedReason: RevokedReason.Rotated,
    });

    expect(await classifyAtNow(token)).toBe(RefreshTokenState.WithinGrace);
  });

  test("猶予期間の境界 (30 秒ちょうど) は内側に含む", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-30_000),
      revokedReason: RevokedReason.Rotated,
    });

    // 境界を外側に倒すと、ちょうど 30 秒で更新を投げたタブが盗難扱いされる。
    expect(await classifyAtNow(token)).toBe(RefreshTokenState.WithinGrace);
  });

  test("猶予期間を 1 ミリ秒でも過ぎたら reused (盗難のサイン)", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-30_001),
      revokedReason: RevokedReason.Rotated,
    });

    expect(await classifyAtNow(token)).toBe(RefreshTokenState.Reused);
  });

  test("ログアウト・盗難検出で切られた券は猶予期間の内でも revoked", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-5_000), // 5 秒前 = 猶予期間の内
      revokedReason: RevokedReason.Revoked,
    });

    // 理由を見ずに時刻だけで判定していた頃はここが within-grace になり、
    // 切ったはずのセッションが 30 秒間ローテーションできてしまった。
    expect(await classifyAtNow(token)).toBe(RefreshTokenState.Revoked);
  });

  test("失効の理由が読めない券は revoked に倒す (迷ったら猶予を与えない)", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-5_000),
      revokedReason: null,
    });

    expect(await classifyAtNow(token)).toBe(RefreshTokenState.Revoked);
  });

  test("期限ちょうどで expired (期限は含まない)", async () => {
    const token = makeToken({
      expiresAt: at(0),
      revokedAt: null,
      revokedReason: null,
    });

    expect(await classifyAtNow(token)).toBe(RefreshTokenState.Expired);
  });

  test("期限切れは失効理由より優先する", async () => {
    const token = makeToken({
      expiresAt: at(-1_000),
      revokedAt: at(-99_000),
      revokedReason: RevokedReason.Rotated,
    });

    // 期限切れの券を再利用しても攻撃者は何も得られない。一方で 2 週間ぶりに
    // 開いた正規のクライアントを盗難扱いするほうが実害が大きい。
    expect(await classifyAtNow(token)).toBe(RefreshTokenState.Expired);
  });

  test("DB の NULL は Option.none として復元される", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: null,
      revokedReason: null,
    });

    expect(Option.isNone(token.revokedAt)).toBe(true);
    expect(Option.isNone(token.revokedReason)).toBe(true);
  });
});
