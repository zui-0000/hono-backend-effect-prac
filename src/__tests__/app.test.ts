import { describe, expect, test } from "bun:test";

import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";

import { createApp } from "~/app";
import type { AppRuntime } from "~/app-runtime";
import { RefreshTokenIssuer } from "~/contexts/auth/domain/refresh-token-issuer";
import { RefreshTokenRepository } from "~/contexts/auth/domain/refresh-token-repository";
import type { GetUserQueryOutput } from "~/contexts/user/application/get-user-query-service";
import { GetUserQueryService } from "~/contexts/user/application/get-user-query-service";
import { VerifyCredentialsQueryService } from "~/contexts/user/application/verify-credentials-query-service";
import { User } from "~/contexts/user/domain/model/user";
import { UserHashedPassword } from "~/contexts/user/domain/model/value-objects/user-hashed-password";
import { UserId } from "~/contexts/user/domain/model/value-objects/user-id";
import { UserName } from "~/contexts/user/domain/model/value-objects/user-name";
import { UserRepository } from "~/contexts/user/domain/user-repository";
import { AccessTokenIssuer } from "~/shared/domain/access-token-issuer";
import { MailAddress } from "~/shared/domain/model/value-objects/mail-address";
import { PasswordHasher } from "~/shared/domain/password-hasher";
import { UuidGenerator } from "~/shared/domain/uuid-generator";
import { UnauthorizedError } from "~/shared/errors/unauthorized-error";
import { ErrorCode } from "~/shared/presentation/constants/error-code";
import { HttpHeader } from "~/shared/presentation/constants/http-header";
import { HttpStatus } from "~/shared/presentation/constants/http-status";

/**
 * HTTP 境界の統合テスト (DB・実サービスなし)。
 *
 * createApp はランタイムを引数で受け取るため、本番の Layer の代わりに
 * テスト用の Layer から作ったランタイムを渡せる。これにより
 * 「リクエスト → 検証 → ユースケース → 応答」までを
 * DB を起動せず、かつ決定的 (採番が固定) に検証できる。
 */

const FIXED_UUID = "019fa5bc-0000-7000-8000-000000000000";

const REQUEST_ID = "019fa5bc-1111-7000-8000-000000000000";

/** 別人を表す id。「自分自身との重複」と「他人との重複」を区別するために使う。 */
const OTHER_UUID = "019fa5bc-2222-7000-8000-000000000000";

/**
 * ハッシュのフィクスチャ。UserHashedPassword は PHC 形式 (`$<識別子>$...`) を
 * 要求するため、実物と同じ形にしておく必要がある
 * (平文がハッシュ欄に入る事故を型で弾くための制約)。
 */
const EXISTING_HASH = "$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$existing";

/** 偽 PasswordHasher が返す値。実物の代わりだが形は揃える。 */
const FAKE_HASH = "$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$fake";

const validBody = {
  name: "アスカ",
  mailAddress: "asuka@example.com",
  password: "SuperSecret123!",
};

/** 既に永続化されている User 集約。作成/更新日時は 0 に固定して差分を見やすくする。 */
const makeUser = (
  params: { readonly id?: string; readonly mailAddress?: string } = {},
): User => ({
  id: Schema.decodeSync(UserId)(params.id ?? FIXED_UUID),
  name: Schema.decodeSync(UserName)("既存ユーザー"),
  mailAddress: Schema.decodeSync(MailAddress)(
    params.mailAddress ?? "existing@example.com",
  ),
  hashedPassword: Schema.decodeSync(UserHashedPassword)(EXISTING_HASH),
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

/** 偽のリフレッシュトークン。券そのものと、その「ハッシュ」の代わり。 */
const FAKE_REFRESH_TOKEN = "rt_fake-refresh-token-for-tests-0123456789";
const FAKE_TOKEN_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

/** 偽のアクセストークン。契約が 3 セグメント形式を要求するので形は揃える。 */
const FAKE_ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";

/** 偽 AccessTokenIssuer が返す claims。sid はセッション、sub は利用者。 */
const FAKE_CLAIMS = { sub: FIXED_UUID, sid: OTHER_UUID };

/** テスト用ランタイム。検証したいサービスだけケースごとに部分差し替えする。 */
const makeRuntime = (
  overrides: {
    readonly userRepository?: Partial<UserRepository["Type"]>;
    readonly getUserQueryService?: Partial<GetUserQueryService>;
    readonly passwordHasher?: Partial<PasswordHasher>;
    readonly refreshTokenRepository?: Partial<RefreshTokenRepository["Type"]>;
    readonly refreshTokenIssuer?: Partial<RefreshTokenIssuer>;
    readonly accessTokenIssuer?: Partial<AccessTokenIssuer>;
    readonly verifyCredentialsQueryService?: Partial<VerifyCredentialsQueryService>;
  } = {},
): AppRuntime =>
  ManagedRuntime.make(
    Layer.mergeAll(
      Layer.succeed(UserRepository, {
        create: () => Effect.void,
        updateProfile: () => Effect.void,
        updatePassword: () => Effect.void,
        findById: () => Effect.succeed(Option.none()),
        findByMailAddress: () => Effect.succeed(Option.none()),
        deleteById: () => Effect.void,
        ...overrides.userRepository,
      }),
      Layer.succeed(GetUserQueryService, {
        execute: () => Effect.succeed(Option.none()),
        ...overrides.getUserQueryService,
      }),
      Layer.succeed(PasswordHasher, {
        hash: () => Effect.succeed(FAKE_HASH),
        verify: () => Effect.succeed(true),
        ...overrides.passwordHasher,
      }),
      Layer.succeed(RefreshTokenRepository, {
        create: () => Effect.void,
        findByTokenHash: () => Effect.succeed(Option.none()),
        rotate: () => Effect.void,
        revokeSession: () => Effect.void,
        ...overrides.refreshTokenRepository,
      }),
      Layer.succeed(RefreshTokenIssuer, {
        issue: Effect.succeed({
          token: FAKE_REFRESH_TOKEN,
          hash: FAKE_TOKEN_HASH,
        }),
        hash: () => Effect.succeed(FAKE_TOKEN_HASH),
        ...overrides.refreshTokenIssuer,
      }),
      Layer.succeed(AccessTokenIssuer, {
        issue: () => Effect.succeed(FAKE_ACCESS_TOKEN),
        // 既定は「検証を通る」。認証の失敗経路を見るケースだけ差し替える。
        verify: () => Effect.succeed(FAKE_CLAIMS),
        ...overrides.accessTokenIssuer,
      }),
      Layer.succeed(VerifyCredentialsQueryService, {
        execute: () => Effect.succeed(Option.none()),
        ...overrides.verifyCredentialsQueryService,
      }),
      // 採番を固定し、生成される id を予測可能にする。
      Layer.succeed(UuidGenerator, { next: Effect.succeed(FIXED_UUID) }),
    ),
  );

const headers = {
  "Content-Type": "application/json",
  [HttpHeader.RequestId]: REQUEST_ID,
  // 契約が @useAuth(BearerAuth) を宣言している 4 本に要る。
  // 認証不要な createUser でも余分なヘッダは無視されるので共通にする。
  [HttpHeader.Authorization]: `Bearer ${FAKE_ACCESS_TOKEN}`,
};

const postUsers = async (
  runtime: AppRuntime,
  body: Record<string, unknown>,
): Promise<Response> =>
  await createApp(runtime).request("/users", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

const getUser = async (runtime: AppRuntime, id: string): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, { headers });

const putUser = async (
  runtime: AppRuntime,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

const deleteUser = async (runtime: AppRuntime, id: string): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}`, {
    method: "DELETE",
    headers,
  });

const putPassword = async (
  runtime: AppRuntime,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  await createApp(runtime).request(`/users/${id}/password`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

describe("POST /users", () => {
  test("正常系: 201 を返し、ハッシュ済みの User を永続化する", async () => {
    const created: User[] = [];
    const runtime = makeRuntime({
      userRepository: {
        create: (user) =>
          Effect.sync(() => {
            created.push(user);
          }),
      },
    });

    const response = await postUsers(runtime, validBody);

    expect(response.status).toBe(HttpStatus.Created);
    expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    // 採番された id だけを返す (クライアントが GET /users/{id} を呼べるように)。
    expect(await response.json()).toEqual({ id: FIXED_UUID });
    expect(created).toHaveLength(1);
    // 採番は UuidGenerator 経由なので、テストでは固定値になる。
    expect(created[0]?.id).toBe(FIXED_UUID as UserId);
    // ドメインは平文を持たず、PasswordHasher の結果だけを保持する。
    expect(created[0]?.hashedPassword).toBe(FAKE_HASH as UserHashedPassword);
  });

  test("異常系: メールアドレス重複は 409 (errorCode 4091)", async () => {
    const existing = makeUser({ mailAddress: validBody.mailAddress });
    const runtime = makeRuntime({
      userRepository: {
        findByMailAddress: () => Effect.succeed(Option.some(existing)),
      },
    });

    const response = await postUsers(runtime, validBody);

    expect(response.status).toBe(HttpStatus.Conflict);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.MailAddressAlreadyExists,
    });
  });

  test("異常系: 契約に反するリクエストは 400 と該当フィールド", async () => {
    const response = await postUsers(makeRuntime(), {
      ...validBody,
      password: "short",
    });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "password" }],
    });
  });
});

describe("GET /users/:id", () => {
  test("正常系: 200 を返し、契約どおり name / mailAddress のみを含む", async () => {
    const dto: GetUserQueryOutput = {
      name: "アスカ",
      mailAddress: "asuka@example.com",
    };
    const runtime = makeRuntime({
      getUserQueryService: { execute: () => Effect.succeed(Option.some(dto)) },
    });

    const response = await getUser(runtime, FIXED_UUID);

    expect(response.status).toBe(HttpStatus.Ok);
    // 封筒 (result / meta) で包まず、リソースの内容をそのまま返す。
    expect(await response.json()).toEqual({
      name: dto.name,
      mailAddress: dto.mailAddress,
    });
  });

  test("異常系: 存在しない id は 404 (errorCode 4040)", async () => {
    // 既定の fake は Option.none を返す = 見つからない。
    const response = await getUser(makeRuntime(), FIXED_UUID);

    expect(response.status).toBe(HttpStatus.NotFound);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.ResourceNotFound,
    });
  });

  test("異常系: uuid v7 形式でない id は 400 と該当フィールド", async () => {
    const response = await getUser(makeRuntime(), "not-a-uuid");

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "id" }],
    });
  });

  test("異常系: 契約とズレた応答は defect となり、契約どおりの 500 を返す", async () => {
    // 射影が契約を満たさない状況 (mailAddress が文字列でない)。
    // handleWithEffect の orDie で defect になり、E チャネルには現れない。
    const runtime = makeRuntime({
      getUserQueryService: {
        execute: () =>
          Effect.succeed(
            Option.some({
              name: "アスカ",
              mailAddress: 42 as unknown as string,
            }),
          ),
      },
    });

    const response = await getUser(runtime, FIXED_UUID);

    // Hono 既定の平文 500 ではなく、契約の InternalServerError が返る。
    expect(response.status).toBe(HttpStatus.InternalServerError);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.InternalServerError,
    });
    // defect 経路でも相関 ID は失われない (ログと突き合わせられる)。
    expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
  });
});

describe("PUT /users/:id", () => {
  const updateBody = {
    name: "アスカ・改",
    mailAddress: "asuka.new@example.com",
  };

  test("正常系: 204 を返し、更新後の集約を永続化する", async () => {
    const existing = makeUser();
    const updated: User[] = [];
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(existing)),
        updateProfile: (user) =>
          Effect.sync(() => {
            updated.push(user);
          }),
      },
    });

    const response = await putUser(runtime, FIXED_UUID, updateBody);

    expect(response.status).toBe(HttpStatus.NoContent);
    expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    // 204 は本文を持たない。
    expect(await response.text()).toBe("");

    expect(updated).toHaveLength(1);
    expect(updated[0]?.name).toBe(updateBody.name as UserName);
    expect(updated[0]?.mailAddress).toBe(updateBody.mailAddress as MailAddress);
    // changeProfile が触らない項目はそのまま引き継がれる。
    expect(updated[0]?.id).toBe(existing.id);
    expect(updated[0]?.hashedPassword).toBe(existing.hashedPassword);
    expect(updated[0]?.createdAt).toEqual(existing.createdAt);
    // updatedAt だけが進む。
    expect(updated[0]?.updatedAt.getTime()).toBeGreaterThan(
      existing.updatedAt.getTime(),
    );
    // 元の集約は書き換わらない (イミュータブル)。
    expect(existing.name).toBe("既存ユーザー" as UserName);
  });

  test("正常系: メールアドレスを変えない更新は重複扱いにしない", async () => {
    // 自分自身が findByMailAddress にヒットする状況。
    const existing = makeUser({ mailAddress: updateBody.mailAddress });
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(existing)),
        findByMailAddress: () => Effect.succeed(Option.some(existing)),
      },
    });

    const response = await putUser(runtime, FIXED_UUID, updateBody);

    expect(response.status).toBe(HttpStatus.NoContent);
  });

  test("異常系: 他人が使っているメールアドレスは 409 (errorCode 4091)", async () => {
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(makeUser())),
        findByMailAddress: () =>
          Effect.succeed(
            Option.some(
              makeUser({ id: OTHER_UUID, mailAddress: updateBody.mailAddress }),
            ),
          ),
      },
    });

    const response = await putUser(runtime, FIXED_UUID, updateBody);

    expect(response.status).toBe(HttpStatus.Conflict);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.MailAddressAlreadyExists,
    });
  });

  test("異常系: 存在しない id は 404 (errorCode 4040)", async () => {
    // 既定の fake は findById が Option.none を返す。
    const response = await putUser(makeRuntime(), FIXED_UUID, updateBody);

    expect(response.status).toBe(HttpStatus.NotFound);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.ResourceNotFound,
    });
  });

  test("異常系: 契約に反するボディは 400 と該当フィールド", async () => {
    const response = await putUser(makeRuntime(), FIXED_UUID, {
      ...updateBody,
      mailAddress: "not-a-mail",
    });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "mailAddress" }],
    });
  });
});

describe("PUT /users/:id/password", () => {
  const passwordBody = {
    currentPassword: "SuperSecret123!",
    newPassword: "BrandNewSecret456!",
  };

  test("正常系: 204 を返し、新しいハッシュだけを差し替えて永続化する", async () => {
    const existing = makeUser();
    const updated: User[] = [];
    // 照合に渡された値。新旧を取り違えていないことを確かめるために記録する。
    const verified: [string, string][] = [];
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(existing)),
        updatePassword: (user) =>
          Effect.sync(() => {
            updated.push(user);
          }),
      },
      passwordHasher: {
        verify: (plainText, hashed) =>
          Effect.sync(() => {
            verified.push([plainText, hashed]);
            return true;
          }),
      },
    });

    const response = await putPassword(runtime, FIXED_UUID, passwordBody);

    expect(response.status).toBe(HttpStatus.NoContent);
    expect(await response.text()).toBe("");

    // 照合するのは「現在のパスワード」と「保存済みのハッシュ」。
    expect(verified).toEqual([[passwordBody.currentPassword, EXISTING_HASH]]);

    expect(updated).toHaveLength(1);
    // 保存されるのは新しい平文のハッシュ (平文そのものは決して入らない)。
    expect(updated[0]?.hashedPassword).toBe(FAKE_HASH as UserHashedPassword);
    // パスワード以外は据え置き。
    expect(updated[0]?.id).toBe(existing.id);
    expect(updated[0]?.name).toBe(existing.name);
    expect(updated[0]?.mailAddress).toBe(existing.mailAddress);
    expect(updated[0]?.createdAt).toEqual(existing.createdAt);
    // updatedAt だけが進む。
    expect(updated[0]?.updatedAt.getTime()).toBeGreaterThan(
      existing.updatedAt.getTime(),
    );
    // 元の集約は書き換わらない (イミュータブル)。
    expect(existing.hashedPassword).toBe(EXISTING_HASH as UserHashedPassword);
  });

  test("異常系: 現在のパスワードが違えば 401 で、永続化も走らない", async () => {
    const updated: User[] = [];
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(makeUser())),
        updatePassword: (user) =>
          Effect.sync(() => {
            updated.push(user);
          }),
      },
      passwordHasher: { verify: () => Effect.succeed(false) },
    });

    const response = await putPassword(runtime, FIXED_UUID, passwordBody);

    expect(response.status).toBe(HttpStatus.Unauthorized);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.Unauthorized,
    });
    expect(updated).toEqual([]);
  });

  test("異常系: 存在しない id は 404 (errorCode 4040)", async () => {
    // 既定の fake は findById が Option.none を返す。
    const response = await putPassword(makeRuntime(), FIXED_UUID, passwordBody);

    expect(response.status).toBe(HttpStatus.NotFound);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.ResourceNotFound,
    });
  });

  test("異常系: 契約に反する新パスワードは 400 と該当フィールド", async () => {
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(makeUser())),
      },
    });

    const response = await putPassword(runtime, FIXED_UUID, {
      ...passwordBody,
      newPassword: "short",
    });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "newPassword" }],
    });
  });
});

describe("DELETE /users/:id", () => {
  test("正常系: 204 を返し、対象の id を削除する", async () => {
    const deleted: string[] = [];
    const runtime = makeRuntime({
      userRepository: {
        findById: () => Effect.succeed(Option.some(makeUser())),
        deleteById: (id) =>
          Effect.sync(() => {
            deleted.push(id);
          }),
      },
    });

    const response = await deleteUser(runtime, FIXED_UUID);

    expect(response.status).toBe(HttpStatus.NoContent);
    expect(response.headers.get(HttpHeader.RequestId)).toBe(REQUEST_ID);
    expect(await response.text()).toBe("");
    expect(deleted).toEqual([FIXED_UUID as UserId]);
  });

  test("異常系: 存在しない id は 404 で、削除も走らない", async () => {
    const deleted: string[] = [];
    const runtime = makeRuntime({
      userRepository: {
        deleteById: (id) =>
          Effect.sync(() => {
            deleted.push(id);
          }),
      },
    });

    const response = await deleteUser(runtime, FIXED_UUID);

    expect(response.status).toBe(HttpStatus.NotFound);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.ResourceNotFound,
    });
    expect(deleted).toEqual([]);
  });

  test("異常系: uuid v7 形式でない id は 400 と該当フィールド", async () => {
    const response = await deleteUser(makeRuntime(), "not-a-uuid");

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toMatchObject({
      errorCode: ErrorCode.BadRequest,
      details: [{ field: "id" }],
    });
  });
});

describe("認証 (Bearer)", () => {
  /**
   * 契約が `@useAuth(BearerAuth)` を宣言しているエンドポイントで、
   * **実際に Bearer を要求していること**を固定する。
   *
   * ここが壊れると「契約は要認証と言っているのに誰でも通る」状態に戻るが、
   * 応答は 200 系のままなので**気付けない**。実際、auth の実装前はその状態だった。
   */
  const withoutAuth = {
    "Content-Type": "application/json",
    [HttpHeader.RequestId]: REQUEST_ID,
  };

  test("Authorization が無ければ 401 (認証を要求する 4 本すべて)", async () => {
    const runtime = makeRuntime();
    const app = createApp(runtime);
    const id = FIXED_UUID;

    const responses = await Promise.all([
      app.request(`/users/${id}`, { headers: withoutAuth }),
      app.request(`/users/${id}`, {
        method: "PUT",
        headers: withoutAuth,
        body: JSON.stringify({ name: "新", mailAddress: "new@example.com" }),
      }),
      app.request(`/users/${id}/password`, {
        method: "PUT",
        headers: withoutAuth,
        body: JSON.stringify({
          currentPassword: "SuperSecret123!",
          newPassword: "BrandNewSecret456!",
        }),
      }),
      app.request(`/users/${id}`, { method: "DELETE", headers: withoutAuth }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(HttpStatus.Unauthorized);
    }
  });

  test("作成は認証不要 (サインアップ想定なので Bearer 無しで通る)", async () => {
    const runtime = makeRuntime();

    const response = await createApp(runtime).request("/users", {
      method: "POST",
      headers: withoutAuth,
      body: JSON.stringify(validBody),
    });

    expect(response.status).toBe(HttpStatus.Created);
  });

  test("署名の検証に失敗すれば 401 (ヘッダが在っても通さない)", async () => {
    const runtime = makeRuntime({
      accessTokenIssuer: { verify: () => Effect.fail(new UnauthorizedError()) },
    });

    const response = await getUser(runtime, FIXED_UUID);

    expect(response.status).toBe(HttpStatus.Unauthorized);
    expect(await response.json()).toEqual({
      errorCode: ErrorCode.Unauthorized,
      message: expect.any(String),
    });
  });
});
