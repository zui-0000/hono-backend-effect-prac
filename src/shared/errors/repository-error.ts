import { Data } from "effect";

/**
 * インフラ由来の失敗の内訳。
 *
 * **呼び出し側はこれで分岐しない。** 型ではなくフィールドで持っているのはそのためで、
 * どの内訳も presentation 層では同じ 500 に丸まる。分ける目的はログだけ
 * ("DB が落ちている" と "マイグレーション漏れ" を同じ行として扱いたくない)。
 *
 * 型に出すのは呼び出し側が違う扱いをするものだけ、という基準で選んでいる。
 * 3 つの型に割ると全 command のシグネチャが変わるが、誰も分岐しないので
 * 得るものが無い。将来リトライを入れて振る舞いが分岐したら、そのとき型を検討する。
 *
 * 制約違反 (23xxx) はここに含めない。あれは業務ルールの違反が DB で顕在化したもので、
 * MailAddressDuplicationError のようにドメインのエラーへ翻訳する
 * (インフラの調子と客の入力を同じ軸に並べない)。
 */
export const RepositoryFailure = {
  /** 接続できない・切れた (フェイルオーバー、ネットワーク断) */
  Unavailable: "unavailable",
  /** 資源の枯渇 (接続数上限、ディスク満杯)。運用が動く必要がある */
  Exhausted: "exhausted",
  /** 同時実行の衝突 (デッドロック、シリアライズ失敗)。リトライで直りうる */
  Contention: "contention",
  /** 時間切れ (statement_timeout など) */
  Timeout: "timeout",
  /** スキーマ・権限 (テーブルや列が無い、権限不足)。デプロイ側の誤り */
  Schema: "schema",
  /** 値が扱えない (型変換の失敗、長さ超過)。多くは実装の誤り */
  Data: "data",
  /** 分類できなかったもの */
  Unknown: "unknown",
} as const;

export type RepositoryFailure =
  (typeof RepositoryFailure)[keyof typeof RepositoryFailure];

/**
 * リポジトリ操作の失敗 (DB 接続エラー等、インフラ由来)。
 * ドメイン/ユースケースの失敗ではないため、presentation 層では
 * InternalServerError (5000 / HTTP 500) に翻訳する。
 *
 * failure と sqlState はログのための情報で、外部には出さない。
 * 埋めるのは infrastructure 層 (classifyDbFailure)。
 */
export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  readonly failure: RepositoryFailure;
  readonly sqlState?: string;
  readonly cause: unknown;
}> {}
