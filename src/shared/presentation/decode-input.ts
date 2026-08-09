import { Effect, ParseResult, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import { BadRequestError } from "~/shared/errors/bad-request-error";
import type { ErrorDetail } from "~/shared/errors/error-detail";

import { ErrorMessage } from "./constants/error-message";

/**
 * スキーマで検証し、失敗を `BadRequestError`（違反フィールド付き）に変換する。
 *
 * **この層で唯一、controller が直接呼ぶもの。** 検証済みの入力を合成して
 * ユースケースの入力（値オブジェクト）へ変換する用途で使う。
 * 変換に見えるが、戻り値が `Effect<A, BadRequestError>` であるとおり
 * 「組み立てた値がコマンド入力スキーマを満たすか」を検証している。
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
