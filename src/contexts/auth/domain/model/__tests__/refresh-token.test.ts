import { describe, expect, test } from "bun:test";

import { Effect, Schema, TestClock, TestContext } from "effect";

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

describe(classifyRefreshToken.name, () => {
  test("未失効かつ期限内の場合、usable を返すこと", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: null,
      revokedReason: null,
    });

    const state = await classifyAtNow(token);

    expect(state).toBe(RefreshTokenState.Usable);
  });

  test("ローテーション済みで猶予期間の内の場合、within-grace を返すこと", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-5_000),
      revokedReason: RevokedReason.Rotated,
    });

    const state = await classifyAtNow(token);

    expect(state).toBe(RefreshTokenState.WithinGrace);
  });

  test("失効からちょうど 30 秒の場合、境界を内側に含めて within-grace を返すこと", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-30_000),
      revokedReason: RevokedReason.Rotated,
    });

    const state = await classifyAtNow(token);

    // 境界を外側に倒すと、ちょうど 30 秒で更新を投げたタブが盗難扱いされる。
    expect(state).toBe(RefreshTokenState.WithinGrace);
  });

  test("猶予期間を 1 ミリ秒でも過ぎた場合、盗難のサインとして reused を返すこと", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-30_001),
      revokedReason: RevokedReason.Rotated,
    });

    const state = await classifyAtNow(token);

    expect(state).toBe(RefreshTokenState.Reused);
  });

  test("ログアウト・盗難検出で切られた券の場合、猶予期間の内でも revoked を返すこと", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-5_000), // 5 秒前 = 猶予期間の内
      revokedReason: RevokedReason.Revoked,
    });

    const state = await classifyAtNow(token);

    // 理由を見ずに時刻だけで判定していた頃はここが within-grace になり、
    // 切ったはずのセッションが 30 秒間ローテーションできてしまった。
    expect(state).toBe(RefreshTokenState.Revoked);
  });

  test("失効の理由が読めない場合、猶予を与えず revoked に倒すこと", async () => {
    const token = makeToken({
      expiresAt: at(60_000),
      revokedAt: at(-5_000),
      revokedReason: null,
    });

    const state = await classifyAtNow(token);

    expect(state).toBe(RefreshTokenState.Revoked);
  });

  test("期限ちょうどの場合、期限を含めず expired を返すこと", async () => {
    const token = makeToken({
      expiresAt: at(0),
      revokedAt: null,
      revokedReason: null,
    });

    const state = await classifyAtNow(token);

    expect(state).toBe(RefreshTokenState.Expired);
  });

  test("期限切れかつ失効済みの場合、期限切れを優先して expired を返すこと", async () => {
    const token = makeToken({
      expiresAt: at(-1_000),
      revokedAt: at(-99_000),
      revokedReason: RevokedReason.Rotated,
    });

    const state = await classifyAtNow(token);

    // 期限切れの券を再利用しても攻撃者は何も得られない。一方で 2 週間ぶりに
    // 開いた正規のクライアントを盗難扱いするほうが実害が大きい。
    expect(state).toBe(RefreshTokenState.Expired);
  });
});
