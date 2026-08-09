import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { BadRequestError } from "~/shared/errors/bad-request-error";
import type { ConflictError } from "~/shared/errors/conflict-error";
import type { ErrorDetail } from "~/shared/errors/error-detail";
import type { MailAddressAlreadyExistsError } from "~/shared/errors/mail-address-already-exists-error";
import type { RepositoryError } from "~/shared/errors/repository-error";
import type { ResourceNotFoundError } from "~/shared/errors/resource-not-found-error";
import type { UnauthorizedError } from "~/shared/errors/unauthorized-error";

import { ErrorCode } from "../constants/error-code";
import { ErrorMessage } from "../constants/error-message";
import { HttpStatus } from "../constants/http-status";

/**
 * presentation 層が HTTP に翻訳できるエラーの集合。
 * 検証失敗 (Effect Schema の ParseError) は request-validator が
 * BadRequestError に変換するため、ライブラリ由来の型はここには現れない。
 *
 * 対応する HTTP ステータスの昇順に並べる。
 */
export type ApplicationError =
  // 400
  | BadRequestError
  // 401
  | UnauthorizedError
  // 404
  | ResourceNotFoundError
  // 409
  | ConflictError
  | MailAddressAlreadyExistsError
  // 500
  | RepositoryError;

/**
 * エラー応答のボディ (TypeSpec の各 *Error モデルと対応)。
 *
 * 成功応答を封筒 (result / meta) で包まないのと同じく、エラーもフラットに返す
 * (経緯は docs/02-architecture.md の「API 応答を封筒で包まない」)。
 */
export type ErrorBody = {
  readonly errorCode: ErrorCode;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
};

/** HTTP 応答 (ステータスコードとボディ) 。 */
export type HttpErrorResponse = {
  readonly status: ContentfulStatusCode;
  readonly body: ErrorBody;
};

/**
 * エラー応答のボディを組み立てる。時刻を含まなくなったため純粋な関数。
 * details は未指定ならキー自体を落とす (契約上も任意項目のため)。
 */
const errorBody = (params: {
  readonly errorCode: ErrorCode;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
}): ErrorBody => ({
  errorCode: params.errorCode,
  message: params.message,
  ...(params.details === undefined ? {} : { details: params.details }),
});

/**
 * 型付きエラーに翻訳できない失敗 (defect) に対する応答。
 *
 * defect は ApplicationError ではないので handleErrorResponse では扱えないが、
 * 外に見せる形は 500 と同じでなければならない (契約の InternalServerError)。
 * 応答ボディの組み立てを 1 箇所に保つため、翻訳表と同じこのファイルに置く。
 */
export const defectResponse: HttpErrorResponse = {
  status: HttpStatus.InternalServerError,
  body: errorBody({
    errorCode: ErrorCode.InternalServerError,
    message: ErrorMessage.InternalServerError,
  }),
};

/**
 * ドメイン/アプリケーションのエラーを HTTP 応答へ翻訳する。
 * バックエンド全体のエラーハンドリングを司る唯一の窓口。
 *
 * ドメイン層は HTTP を知らないため、ステータスコードと errorCode の対応付けは
 * この境界に閉じ込める。TypeSpec で定義した契約 (errorCode 体系) と対になる。
 *
 * case はステータスコードの昇順に並べ、同じステータス内では
 * 汎用エラー (errorCode の下 1 桁が 0) を先に置く。
 */
export const handleErrorResponse = (
  error: ApplicationError,
): HttpErrorResponse => {
  switch (error._tag) {
    // ---- 400 Bad Request (汎用) ----
    // リクエストが不正 (検証違反・JSON として読めない等)。
    // 違反フィールドは request-validator が details に詰めている。
    case "BadRequestError":
      return {
        status: HttpStatus.BadRequest,
        body: errorBody({
          errorCode: ErrorCode.BadRequest,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        }),
      };

    // ---- 401 Unauthorized (汎用) ----
    case "UnauthorizedError":
      return {
        status: HttpStatus.Unauthorized,
        body: errorBody({
          errorCode: ErrorCode.Unauthorized,
          message: ErrorMessage.Unauthorized,
        }),
      };

    // ---- 404 Not Found (汎用) ----
    case "ResourceNotFoundError":
      return {
        status: HttpStatus.NotFound,
        body: errorBody({
          errorCode: ErrorCode.ResourceNotFound,
          message: ErrorMessage.NotFound,
        }),
      };

    // ---- 409 Conflict (汎用) ----
    case "ConflictError":
      return {
        status: HttpStatus.Conflict,
        body: errorBody({
          errorCode: ErrorCode.Conflict,
          message: error.message,
        }),
      };

    // ---- 409 Conflict (メールアドレスの重複) ----
    case "MailAddressAlreadyExistsError":
      return {
        status: HttpStatus.Conflict,
        body: errorBody({
          errorCode: ErrorCode.MailAddressAlreadyExists,
          message: ErrorMessage.MailAddressAlreadyExists,
        }),
      };

    // ---- 500 Internal Server Error ----
    // インフラ由来の失敗。原因 (cause) は外部に露出せず、ログにのみ残す。
    case "RepositoryError":
      return {
        status: HttpStatus.InternalServerError,
        body: errorBody({
          errorCode: ErrorCode.InternalServerError,
          message: ErrorMessage.InternalServerError,
        }),
      };
  }
};
