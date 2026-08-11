import { Data } from "effect";

/**
 * リソースが存在しない (汎用 / errorCode 4040 / HTTP 404)。
 *
 * message を持たない。汎用エラーなので文言は常に同じで、
 * 外向けの文言を決めるのは presentation の責務だから
 * (handle-error-response.ts が ErrorMessage.NotFound を割り当てる)。
 * 投げる側が毎回同じ文字列を渡す必要はなく、application 層が
 * presentation の定数を import する理由も無くなる。
 *
 * 「どのリソースが」を伝えたい場合は、まず契約 (TypeSpec) に固有の errorCode を
 * 足す (Conflict "4090" に対する MailAddressDuplication "4091" と同じやり方)。
 */
export class ResourceNotFoundError extends Data.TaggedError(
  "ResourceNotFoundError",
)<{}> {}
