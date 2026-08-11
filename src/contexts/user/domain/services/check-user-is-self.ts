import { Effect } from "effect";

import { ForbiddenError } from "~/shared/errors/forbidden-error";

import type { UserId } from "../model/value-objects/user-id";

/**
 * 操作の対象が、操作している本人かを検証する (ドメインサービス)。
 * 「利用者は自分自身の情報だけを変更できる」という業務ルールを担う。
 *
 * ## なぜドメインサービスなのか
 *
 * 認可の規則は**ビジネスルール**であって、HTTP や presentation の都合ではない。
 * 「誰が何をしてよいか」は仕様として決まっていて、変わるときは仕様が変わるとき。
 * 集約 1 つを見ても判断できない (対象と actor という 2 つの id が要る) ので、
 * 集約にも値オブジェクトにも属さない。`checkMailAddressDuplication` と同じ立ち位置。
 *
 * 規則がまだ 1 つしかないので、ポリシーオブジェクトにはしていない。
 * ロールや「管理者は他人も編集できる」が出てきたら、ここが自然にポリシーへ育つ
 * (この repo は[実例が 1 つの間は抽象化しない]方針を採っている)。
 *
 * ## クエリ側も同じものを使う
 *
 * 読み取りを「引く範囲を絞る」形 (WHERE に actor を足す) で認可する案もあり、一度そう実装した。
 * だが**それだと認可の失敗が 0 件 → 404 になる**。「認可の失敗は対象の有無に関わらず 403」
 * と決めたので、クエリも `getUserQuery` がこの関数で照合してから引く。
 * コマンドとクエリで規則の表現が割れないことを優先した。
 */
export const checkUserIsSelf = (
  target: UserId,
  actor: UserId,
): Effect.Effect<void, ForbiddenError> =>
  target === actor ? Effect.void : new ForbiddenError();
