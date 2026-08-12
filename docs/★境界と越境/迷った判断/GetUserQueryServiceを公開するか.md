# `GetUserQueryService` を `public/` に置くか

**結論: 置かない（2026-08-12）。** 引き金を決めて据え置いた。

---

## 何に迷ったか

`public/` を切ったとき、user には読み取りポートが 2 本あった。

```text
public/verify-credentials-query-service.ts   ← auth の要求で公開した
application/get-user-query-service.ts        ← ここをどうするか
```

出た問いはこれ。

> 「ユーザー情報取得」というエンドポイントは、常識的に考えて
> **アプリが拡張したら必ずあらゆるコンテキストから呼ばれる**。
> なので public にするべきではないか？

**前提は正しい。** 他コンテキストが利用者情報を要求するのは、ほぼ確実に起きる。

---

## 測った

現在の参照元（user の外からは 0 件）。

```text
user-runtime.ts                    user 自身
application/get-user-query.ts      user 自身
infrastructure/…-live.ts           user 自身
presentation/get-user-controller   user 自身
__mocks__/app-runtime.ts           テスト基盤

auth / shared から                 → 0 件
```

そして**返す形が HTTP 契約と 1:1** だった。

```text
GetUserQueryOutput   { name, mailAddress }
GetUser200Response   { name, mailAddress }     ← 完全一致
SELECT               { name, mailAddress }     ← id すら引いていない
```

---

## 決め手

### ① 要るのは「利用者情報」で、「`GET /users/{id}` が返す形」ではない

| 将来のコンテキスト | 欲しいもの                         |
| ------------------ | ---------------------------------- |
| notification       | `mailAddress` + `name` + `locale`? |
| order              | `name`（表示用）/ `id`             |
| audit              | `id` と表示名                      |

**`id` を引いていない**のが決定的だった。他コンテキストが「この利用者は誰か」を
扱おうとした瞬間に足りない。

いま公開すると、全員が **user の HTTP 契約に相乗り**することになる。

- フロントが `avatarUrl` を欲しがって `GET /users/{id}` に足す
  → **notification も order も audit も、見えなくていいものが見える**
- notification が `locale` を欲しがる
  → **`GET /users/{id}` の応答に `locale` が生える**

HTTP 契約の変更が他コンテキストへ、他コンテキストの要求が HTTP 契約へ、
それぞれ波及する。

### ② `public/` は「能力」ではなく「約束」

置く ＝「**この形を、あなたのために安定させ続けます**」という宣言。
誰も要求していないのに約束するのは、[Customer/Supplier](../用語集.md#顧客供給者customersupplier) の向きが逆。

`VerifyCredentialsQueryService` は auth が「照合してほしい」と言ったから生まれ、
**名前に要求が出ている**。`GetUserQueryService` は user が自分の層を分けるために
切ったもので、要求者が user 自身。

### ③ 間違えたときのコストが非対称

| 判断         | 外れたときにやること                                                    |
| ------------ | ----------------------------------------------------------------------- |
| **据え置く** | そのとき要求に合わせたポートを 1 本足す。**ファイル 1 つ。既存は無傷**  |
| **公開する** | 使われ始めてからでは**剥がせない**。HTTP 契約に縛られた射影を全員が掴む |

**「後で足す」と「後で剥がす」なら、足す方が圧倒的に安い。**

---

## 引き金と、そのときやること

> **2 つ目のコンテキストが利用者情報を要求したら、`public/` にポートを作る。**

そのとき決めること。

1. **要求の名前を付ける。** `GetUserQueryService` ではなく、要求が読める名前
   （`VerifyCredentialsQueryService` が「照合してほしい」と読めるのと同じ）
2. **`GET /users/{id}` の射影とは別に定義する。**
   偶然同じ形になっても、**変わる理由が違う**ので共有しない
3. **`id` を含めるか決める。** 他コンテキストが集約の項目にするなら
   `UserId` を branded で返す（`VerifyCredentialsQueryService` と同じ判断）

---

## 見送った案

**「1 つの user 参照ポートを公開して全員で使う」も現実には普通にある。**
ポートの本数を抑えられる利点があり、否定はしない。

採らなかったのは、**いまのそれが HTTP 契約と 1:1 で `id` も持っていない**から。
公開するなら「HTTP 契約から切り離した公開ビュー」として作り直すべきで、
それは要求が出てから形を決めた方がよい。

先回りで汎用ポートを置くと [god interface](../用語集.md#god-interface神インターフェース) に育ちやすい、
という懸念もある。
