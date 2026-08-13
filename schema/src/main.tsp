import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";
import "./contexts/users/index.tsp";
import "./contexts/auth/index.tsp";
import "./shared/index.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

/** hono-backend-effect-prac のバックエンド API (users / auth) */
@service(#{ title: "hono-backend-effect-prac backend API" })
@info(#{ version: "0.1.0" })
namespace BackendApi {
  @tag("Users")
  @route("/users")
  namespace Users {
    /** ユーザーを新規作成する (サインアップ想定のため認証不要) */
    @post
    @operationId("createUser")
    op create(...CommonHeaders, @body body: CreateUserRequest):
      | SuccessCreatedResponse<CreateUserResponse>
      | BadRequestErrorResponse
      | MailAddressDuplicationErrorResponse
      | InternalServerErrorResponse;

    /** IDを指定してユーザーを取得する (要認証) */
    @get
    @route("/{id}")
    @useAuth(BearerAuth)
    @operationId("getUser")
    op get(...CommonHeaders, @path id: UserId):
      | SuccessOkResponse<GetUserResponse>
      | BadRequestErrorResponse
      | UnauthorizedErrorResponse
      | ForbiddenErrorResponse
      | NotFoundErrorResponse
      | InternalServerErrorResponse;

    /** ユーザーを更新する (要認証) */
    @put
    @route("/{id}")
    @useAuth(BearerAuth)
    @operationId("updateUser")
    op update(
      ...CommonHeaders,
      @path id: UserId,
      @body body: UpdateUserRequest,
    ):
      | SuccessNoContentResponse
      | BadRequestErrorResponse
      | UnauthorizedErrorResponse
      | ForbiddenErrorResponse
      | NotFoundErrorResponse
      | MailAddressDuplicationErrorResponse
      | InternalServerErrorResponse;

    /** ユーザーを削除する (要認証) */
    @delete
    @route("/{id}")
    @useAuth(BearerAuth)
    @operationId("deleteUser")
    op delete(...CommonHeaders, @path id: UserId):
      | SuccessNoContentResponse
      | BadRequestErrorResponse
      | UnauthorizedErrorResponse
      | ForbiddenErrorResponse
      | NotFoundErrorResponse
      | InternalServerErrorResponse;

    /** パスワードを変更する (要認証。現在のパスワードで本人確認する) */
    @put
    @route("/{id}/password")
    @useAuth(BearerAuth)
    @operationId("changePassword")
    op changePassword(
      ...CommonHeaders,
      @path id: UserId,
      @body body: ChangePasswordRequest,
    ):
      | SuccessNoContentResponse
      | BadRequestErrorResponse
      | UnauthorizedErrorResponse
      | ForbiddenErrorResponse
      | NotFoundErrorResponse
      | InternalServerErrorResponse;
  }

  @tag("Auth")
  @route("/auth")
  namespace Auth {
    /** ログイン (メール・パスワードでトークンを発行する。認証不要) */
    @post
    @route("/login")
    @operationId("login")
    op login(...CommonHeaders, @body body: LoginRequest):
      | LoginSuccessResponse
      | BadRequestErrorResponse
      | UnauthorizedErrorResponse
      | InternalServerErrorResponse;

    /** ログアウト (要認証。リフレッシュトークンを失効させ、Cookie も消す) */
    @post
    @route("/logout")
    @useAuth(BearerAuth)
    @operationId("logout")
    op logout(...CommonHeaders):
      | LogoutSuccessResponse
      | BadRequestErrorResponse
      | UnauthorizedErrorResponse
      | InternalServerErrorResponse;

    // 券の受け取りに @useAuth(ApiKeyAuth<ApiKeyLocation.cookie, ...>) ではなく
    // @cookie を使っている。前者は securityScheme にしかならず「資格情報がある」
    // としか言えないが、@cookie なら in: cookie のパラメータとして
    // **値の型 (RefreshToken) まで契約に出る**。
    // ただし orval は Cookie パラメータのスキーマを生成しない (実測済み) ので、
    // 検証用のスキーマは実装側の手書きが残る。経緯は docs/05-auth/01-our-approach.md。
    /** アクセストークンを再発行する (券は HttpOnly Cookie で受け取る。認証不要) */
    @post
    @route("/refresh")
    @operationId("refresh")
    op refresh(...CommonHeaders, @cookie refreshToken: RefreshToken):
      | RefreshSuccessResponse
      | BadRequestErrorResponse
      | UnauthorizedErrorResponse
      | InternalServerErrorResponse;
  }
}
