import { Data } from "effect";

import type { MailAddress } from "~/shared/domain/model/value-objects/mail-address";

/**
 * メールアドレスが既に使用されている (errorCode 4091 / HTTP 409)。
 * 「アプリ側の事前チェック」と「DB の unique 制約 (最後の砦)」の二段構えで検出し、
 * どちらの経路でもこのエラーに翻訳する。
 */
export class MailAddressDuplicationError extends Data.TaggedError(
  "MailAddressDuplicationError",
)<{
  readonly mailAddress: MailAddress;
}> {}
