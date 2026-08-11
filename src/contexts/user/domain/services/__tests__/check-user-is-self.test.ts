import { describe, expect, test } from "bun:test";

import { Effect, Either, Schema } from "effect";

import { FIXED_UUID, OTHER_UUID } from "~/__mocks__/data";
import { ForbiddenError } from "~/shared/errors/forbidden-error";

import { UserId } from "../../model/value-objects/user-id";
import { checkUserIsSelf } from "../check-user-is-self";

const id = (value: string): UserId => Schema.decodeSync(UserId)(value);

/**
 * 認可の規則そのものを固定する。I/O を持たない純粋な判定なので、
 * HTTP 越しに確かめる controller のテストとは別にここで押さえておく
 * (あちらは「403 として外に出ること」を見る)。
 */
describe(checkUserIsSelf.name, () => {
  test("対象と actor が同じなら通ること", () => {
    const result = Effect.runSync(
      Effect.either(checkUserIsSelf(id(FIXED_UUID), id(FIXED_UUID))),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  test("対象と actor が違うなら ForbiddenError で失敗すること", () => {
    const result = Effect.runSync(
      Effect.either(checkUserIsSelf(id(FIXED_UUID), id(OTHER_UUID))),
    );

    expect(result).toStrictEqual(Either.left(new ForbiddenError()));
  });

  test("向きを入れ替えても失敗すること (対称であること)", () => {
    // 「自分が対象を操作してよいか」であって「対象が自分か」ではないので、
    // 引数の順を取り違えても結果が変わらないことを固定しておく。
    const result = Effect.runSync(
      Effect.either(checkUserIsSelf(id(OTHER_UUID), id(FIXED_UUID))),
    );

    expect(result).toStrictEqual(Either.left(new ForbiddenError()));
  });
});
