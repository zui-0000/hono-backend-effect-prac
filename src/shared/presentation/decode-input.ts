import { Effect, ParseResult, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import { BadRequestError } from "~/shared/errors/bad-request-error";
import type { ErrorDetail } from "~/shared/errors/error-detail";

import { ErrorMessage } from "./constants/error-message";

/**
 * スキーマで検証し、失敗を `BadRequestError`（違反フィールド付き）に変換する。
 *
 * **この層で唯一、controller が直接呼ぶもの。** 契約で検証済みの入力を合成して、
 * ユースケースの入力（値オブジェクト）を組み立てるために使う。
 *
 * ## 値は変えない。型に検証の履歴を刻む
 *
 * ランタイムでは実質、恒等関数になっている。契約スキーマとコマンド入力スキーマは
 * 制約が一致しているため（長さも正規表現も同値。実測で確認）、`validateRequest` を
 * 通った値がここで 400 になることは今のところ無い。branded 型もラッパーではなく
 * ただの `string` で、`decode` の前後で `===` が成り立つ（これも実測）。
 *
 * それでも省けない。**brand は「検証を通った」という証明書**で、型が消える
 * コンパイル後には残らない。だからこそ `UserId` を得る道を decode だけに絞る必要がある。
 * 省くと `Type 'string' is not assignable to type 'string & Brand<"User.Id">'` で止まる。
 * `as UserId` と書けば偽造できるが、それは嘘だと分かって書く行為で、うっかり通り抜けない。
 *
 * ## 制約の二重定義は意図したもの
 *
 * `shared/domain` は `~/generated` を参照できない（lint で禁止）ので、ドメインは契約を
 * 信用せず自分で制約を宣言する。今 400 が出ないのは両者が一致している「今」の話で、
 * 契約が緩められたときはここが最後の砦になる。
 *
 * かつてはもう 1 つ、`MailAddress` の小文字化という**実際に値を変える**仕事があった。
 * それは 2026-08-11 に外した（利用者が名乗った表記を潰さないため。経緯は
 * `shared/domain/model/value-objects/mail-address.ts`）。残っているのは型の仕事だけ。
 *
 * `handler/validate-request.ts` の `validate*` はこれの薄い上乗せで、
 * 「HTTP のどこから値を取り出すか」だけが違う。
 *
 * `errors: "all"` で最初の違反では止めず、全フィールドの違反を集めてから
 * 変換する（Effect Schema の `ParseError` を層の外へ漏らさない）。
 */
const decodeOptions = { errors: "all" } as const;

/**
 * 検証エラーを「どのフィールドが、なぜ不正か」の一覧へ変換する。
 * ArrayFormatter は違反箇所の path とメッセージを構造化して返すため、
 * ネストしたフィールドは "meta.respondedAt" のようにドット区切りで表現する。
 * path が空 (ボディ全体が不正など) の場合は "-" とする。
 */
const toErrorDetails = (error: ParseError): readonly ErrorDetail[] =>
  ParseResult.ArrayFormatter.formatErrorSync(error).map((issue) => ({
    field: issue.path.length === 0 ? "-" : issue.path.join("."),
    message: issue.message,
  }));

export const decodeInput = <A, I>(
  schema: Schema.Schema<A, I>,
  source: unknown,
): Effect.Effect<A, BadRequestError> =>
  Schema.decodeUnknown(
    schema,
    decodeOptions,
  )(source).pipe(
    Effect.mapError(
      (error) =>
        new BadRequestError({
          message: ErrorMessage.BadRequest,
          details: toErrorDetails(error),
        }),
    ),
  );
