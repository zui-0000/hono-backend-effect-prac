import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import { Config, Context, Effect, Layer, Redacted } from "effect";

/**
 * Drizzle クライアントを表すサービス (ポート)。
 *
 * ポートと実装を同居させているのは、ここが infrastructure の中で、
 * 参照できるのが元から「実装を知ってよい側」だけだから。
 * shared/domain と shared/infrastructure を分けたのは、ポートを import しただけで
 * 実装の依存まで引きずり込むのを避けるためで、その心配がここには無い。
 * 公開する型から `$client` を落としているのは、接続の後始末をこのファイルの責務に閉じ、
 * 利用側に drizzle を迂回する余地を残さないため。
 * 経緯は 02-architecture.md「DB 接続も Layer で注入する」。
 */
export type Database = BunSQLDatabase;
export const Database = Context.GenericTag<Database>("Database");

/**
 * 本番実装。接続を 1 つだけ作り、ランタイムの破棄に合わせて閉じる。
 *
 * 接続情報は Config 経由で読むため、未設定なら Layer の構築時点で落ちる。
 * その失敗を orDie で defect にしているのは、環境変数の不足が回復しようのない
 * 起動失敗だから (ランタイムの型を E = never に保てる副次的な利点もある)。
 */
export const DatabaseLive = Layer.scoped(
  Database,
  Effect.gen(function* () {
    const url = yield* Config.redacted("DATABASE_URL");
    return yield* Effect.acquireRelease(
      Effect.sync(() => drizzle(Redacted.value(url))),
      // 引数なしの close は実行中のクエリの完了を待ってから閉じる。
      (database) => Effect.promise(() => database.$client.close()),
    );
  }),
).pipe(Layer.orDie);
