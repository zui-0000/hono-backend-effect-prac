import { Data } from "effect";

/**
 * 操作する権限が無い (認可の失敗)。
 *
 * **外部には 404 として返す。** 403 だと「その id の利用者は存在する」と教えることになり、
 * 総当たりで id の実在を判定できてしまう。いまの規則は「本人のリソースだけ」なので、
 * 他人から見れば存在しないのと同じ、と扱うほうが漏れが少ない
 * (割り当ては handle-error-response.ts。契約に 403 を足さずに済む利点もある)。
 *
 * それでも `ResourceNotFoundError` を使い回さず専用の型にしてあるのは、
 * **ログには真実を残すため**。`logFailure` が `errorTag` を出すので、
 * 「本当に無かった」のか「権限が無くて隠した」のかがログ側で切り分けられる。
 * 認可の失敗が続いていることも、これが無いと気付けない。
 *
 * message を持たないのは `ResourceNotFoundError` と同じ理由。汎用エラーの文言を
 * 決めるのは presentation の責務で、外向けには 404 の定型文が出る。
 */
export class ForbiddenError extends Data.TaggedError("ForbiddenError")<{}> {}
