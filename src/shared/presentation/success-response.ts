import { Effect, Schema } from "effect";

import { HttpStatus } from "./constants/http-status";

/**
 * 本文を持てるステータスと、持てないステータス。
 *
 * この区別を決めたのは HTTP であってこちらではない。204 は「ヘッダ直後の空行で
 * 終端するため本文を持てない」と定められており (RFC 9110 §15.3.5)、Fetch の
 * `Response` も 204 を null body status として本文付きの生成を拒む。
 * Hono の `ContentfulStatusCode` / `ContentlessStatusCode` が同じ軸で、
 * `c.json` が前者しか受け取らないのもそのため。
 *
 * **その Hono の名前は借りない。** あちらは 400 も 500 も含む全域を指すのに対し、
 * こちらはこの API の成功応答だけを指す。集合が違うのに名前が 1 文字違いだと、
 * 本物の `ContentfulStatusCode` を使っている `handler/handle-error-response.ts` の
 * 隣で見分けがつかなくなる。下の `withBody` / `withoutBody` と揃う名前にしてある。
 */
type BodyStatus = typeof HttpStatus.Ok | typeof HttpStatus.Created;
type NoBodyStatus = typeof HttpStatus.NoContent;

/**
 * controller が返す「成功応答の記述」。
 *
 * 失敗側 ([`handler/handle-error-response.ts`](./handler/handle-error-response.ts))
 * と対になる。あちらがエラーを HTTP へ翻訳するのに対し、こちらは**成功だけ**を扱う。
 *
 * Hono の `Context` には触れず、記述を返すだけにしてある。controller が
 * HTTP の組み立てを知る必要はなく、実際の `Response` にするのは
 * `handleWithEffect` の仕事。
 *
 * **判別子は `status` そのもの。** 本文を持てるかどうかはステータスが決まれば
 * 決まるので、別に `_tag` を持たせると同じことを 2 箇所で言うことになる。
 * この形なら「204 に本文」も「200 に本文なし」も型として書けない。
 */
export type SuccessResponse =
  | { readonly status: NoBodyStatus }
  | { readonly status: BodyStatus; readonly body: unknown };

/**
 * 本文のある応答にする。
 *
 * **スキーマは 2 つ仕事をする。** 値の型を縛る (コンパイル時) のと、
 * 契約の精製を確かめる (実行時) の両方。
 *
 * 後者が要るのは、**クエリ側がドメインを経由しない**から。
 * `GetUserQueryService` は DB の行をそのまま返すので、値オブジェクトの検証を
 * 一度も通らない。長さや形式が壊れた行があれば、ここが唯一の関所になる。
 * 加えて契約 (TypeSpec) とドメインの制約は別々に宣言されており、
 * 片方だけ変わってもここでしか気付けない。
 *
 * 契約とズレた応答は**バグ**なので `orDie` で defect にする。クライアントには
 * `handleFailures` が契約どおりの 500 を返す (エラー応答は握り潰さない)。
 */
const withBody =
  (status: BodyStatus) =>
  <A, I>(schema: Schema.Schema<A, I>) =>
  <E, R>(
    effect: Effect.Effect<I, E, R>,
  ): Effect.Effect<SuccessResponse, E, R> =>
    effect
      .pipe(
        // orDie を decode にだけ掛ける。全体に掛けると command の
        // ApplicationError まで defect になり、401 や 404 が 500 に化ける。
        Effect.flatMap((value) =>
          Schema.decodeUnknown(schema)(value).pipe(Effect.orDie),
        ),
      )
      .pipe(Effect.map((body) => ({ status, body })));

/**
 * 本文のない応答にする。値は捨てるので、検証するスキーマも受け取らない。
 *
 * 渡せるステータスが 204 しか無いのに引数で受けるのは、`withBody` と形を
 * 揃えるため。揃えておくと下の表でステータスが縦に並び、どの段が何番を返すかを
 * 1 箇所で読める。
 */
const withoutBody =
  (status: NoBodyStatus) =>
  <E, R>(
    effect: Effect.Effect<unknown, E, R>,
  ): Effect.Effect<SuccessResponse, E, R> =>
    effect.pipe(Effect.as({ status }));

/**
 * 成功応答の作り方。**pipe に載る形**にしてある。
 *
 * この層の他の出口 (`orNotFound` / `handleFailures`) と同じ作法で、
 * command や query の結果をそのまま流し込める。
 *
 * **ステータスと本文の有無が、そのまま表になっている。** 応答を決めるのは
 * この 2 つだけなので、controller 側は名前を選ぶだけで済み、数字を手で書く
 * 場所が無い。契約に現れるのは 200 / 201 / 204 の 3 つだけなので、いまはこれで
 * 足りる (増やすのは実例が出てから)。
 *
 * 値は**スキーマの Encoded 側**で受ける。生成スキーマの `Type` は brand が
 * 付いていて素のリテラルを受け付けないため (リクエスト側の `satisfies` と同じ理由)。
 */
export const SuccessResponse = {
  /** 200。取得系の応答。 */
  Ok: withBody(HttpStatus.Ok),

  /** 201。作成した資源の識別子を返す。 */
  Created: withBody(HttpStatus.Created),

  /** 204。状態を変えるだけで値を返さない (CQRS のコマンド)。 */
  NoContent: withoutBody(HttpStatus.NoContent),
} as const;
