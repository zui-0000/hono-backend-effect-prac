import type { Effect } from "effect";
import { Context } from "effect";

/**
 * パスワードのハッシュ化・照合を行うサービス。
 * ハッシュ計算という副作用 (かつ実行環境依存の実装) を Effect に閉じ込め、DI で差し替え可能にする。
 *
 * ドメインは平文を持たず、ハッシュ済みの値 (UserHashedPassword) だけを扱う。
 * このサービスは application 層から呼ばれ、平文とハッシュの境界を担う。
 *
 * 型 (interface) と Tag (const) を同名で定義し、DI の鍵と依存型を1つの名前で扱う。
 */
export interface PasswordHasher {
  /** 平文パスワードをハッシュ化する。 */
  readonly hash: (plainText: string) => Effect.Effect<string>;
  /** 平文パスワードがハッシュと一致するか検証する。 */
  readonly verify: (
    plainText: string,
    hashed: string,
  ) => Effect.Effect<boolean>;
}
export const PasswordHasher =
  Context.GenericTag<PasswordHasher>("PasswordHasher");
