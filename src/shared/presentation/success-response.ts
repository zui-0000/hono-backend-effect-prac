import { Effect, Schema } from "effect";

import { HttpStatus } from "./constants/http-status";

/**
 * controller が返す「成功応答の記述」。
 *
 * 失敗側 ([`handler/handle-error-response.ts`](./handler/handle-error-response.ts))
 * と対になる。あちらがエラーを HTTP へ翻訳するのに対し、こちらは**成功だけ**を扱う。
 *
 * Hono の `Context` には触れず、記述を返すだけにしてある。controller が
 * HTTP の組み立てを知る必要はなく、実際の `Response` にするのは
 * `handleWithEffect` の仕事。
 */
export type SuccessResponse =
  | { readonly _tag: "NoContent" }
  | {
      readonly _tag: "Body";
      readonly status: typeof HttpStatus.Ok | typeof HttpStatus.Created;
      readonly body: unknown;
    };

/**
 * 本文を API 契約で検証してから応答にする。
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
const body =
  (status: typeof HttpStatus.Ok | typeof HttpStatus.Created) =>
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
      .pipe(
        Effect.map((decoded) => ({
          _tag: "Body" as const,
          status,
          body: decoded,
        })),
      );

/**
 * 成功応答の作り方。**pipe に載る形**にしてある。
 *
 * この層の他の出口 (`orNotFound` / `handleFailures`) と同じ作法で、
 * command や query の結果をそのまま流し込める。
 *
 * `Ok(schema)` と書いた時点で 200 が決まるので、数字を手で書く場所が無い。
 * 契約に現れるのは 200 / 201 / 204 の 3 つだけなので、いまはこれで足りる
 * (増やすのは実例が出てから)。
 *
 * 値は**スキーマの Encoded 側**で受ける。生成スキーマの `Type` は brand が
 * 付いていて素のリテラルを受け付けないため (リクエスト側の `satisfies` と同じ理由)。
 */
export const SuccessResponse = {
  /** 200。取得系の応答。 */
  Ok: body(HttpStatus.Ok),

  /** 201。作成した資源の識別子を返す。 */
  Created: body(HttpStatus.Created),

  /**
   * 204。状態を変えるだけで値を返さない (CQRS のコマンド)。
   *
   * 値を取らないが Ok / Created と同じく pipe の段にしてある。
   * controller の書き方を 1 つに揃えるため。
   */
  NoContent: <E, R>(
    effect: Effect.Effect<unknown, E, R>,
  ): Effect.Effect<SuccessResponse, E, R> =>
    effect.pipe(Effect.as({ _tag: "NoContent" as const })),
} as const;
