import { Effect, Option } from "effect";

import { UnauthorizedError } from "~/shared/errors/unauthorized-error";

/**
 * 「引き当てられなければ 401」というユースケースの方針に名前を与える。
 *
 * [`orNotFound`](./or-not-found.ts) と対になる。形は同じで翻訳先だけが違うが、
 * **使う場面は正反対**なので別の関数にしてある。404 は「対象が無い」と正直に言う出口、
 * 401 は**なぜ失敗したかを言わない**出口。
 *
 * 認証経路で `Option.none` に畳まれているのは、「利用者が居ない」と「パスワードが違う」を
 * 書き分けると総当たりで登録の有無を判定できてしまうため (アカウント列挙)。
 * 畳んだものを畳んだまま外へ出すのがここの仕事で、`if (Option.isNone(...))` を
 * 手で書くと、その分岐に「片方だけ別のエラーにする」余地が残ってしまう。
 *
 * `orNotFound` と同じく、引数はリポジトリではなく Option を返す Effect にしてある。
 * リポジトリに閉じた形にすると呼べる経路が限られるが、Option → 401 の変換だけを
 * 切り出せば、照合 (user のクエリ経路) も券の引き当て (auth のリポジトリ経路) も
 * 同じ形で書ける。
 */
export const orUnauthorized = <A, E, R>(
  effect: Effect.Effect<Option.Option<A>, E, R>,
): Effect.Effect<A, E | UnauthorizedError, R> =>
  Effect.flatMap(
    effect,
    Option.match({
      onNone: () => new UnauthorizedError(),
      onSome: Effect.succeed<A>,
    }),
  );
