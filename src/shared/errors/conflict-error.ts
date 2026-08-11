import { Data } from "effect";

/**
 * リソースの現在の状態と衝突する (汎用 / errorCode 4090 / HTTP 409)。
 * 具体的な事由がある衝突は専用エラー (例: MailAddressDuplicationError) を使う。
 */
export class ConflictError extends Data.TaggedError("ConflictError")<{
  readonly message: string;
}> {}
