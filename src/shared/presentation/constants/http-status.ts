/**
 * この API が返す HTTP ステータスコード。
 *
 * `errorCode` 体系 (`./error-code.ts`) と対になる。
 * errorCode が `<HTTP ステータス><連番>` の 4 桁なので、両者を並べると
 * 対応が読める (例: `HttpStatus.Conflict` ↔ `ErrorCode.MailAddressDuplication` = "4091")。
 *
 * `as const` を付けているのはリテラル型を保つため。`HttpStatus.NoContent` が
 * `number` に広がると、本文なし応答を表す判別可能ユニオン
 * (`handle-with-effect.ts` の NoContentResponse) が機能しなくなる。
 *
 * 契約 (TypeSpec) に無いステータスはここにも書かない。増やすときは
 * まず `schema/` の契約に足す。
 */
export const HttpStatus = {
  /** 200 取得成功 (本文あり) */
  Ok: 200,
  /** 201 作成成功 (本文あり) */
  Created: 201,
  /** 204 成功したが返す本文がない (更新・削除) */
  NoContent: 204,
  /** 400 リクエスト内容が不正 */
  BadRequest: 400,
  /** 401 認証情報が不正 */
  Unauthorized: 401,
  /** 404 リソースが存在しない */
  Forbidden: 403,
  NotFound: 404,
  /** 409 リソースの現在の状態と衝突する */
  Conflict: 409,
  /** 500 サーバー内部で予期せぬエラーが発生した */
  InternalServerError: 500,
} as const;

export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];
