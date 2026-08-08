# 02. 構造と命名の規約

ディレクトリの切り方・命名・API 応答の形について、**なぜそうしたか** を残す。
ここに書いた規約の多くは lint で機械的に強制している（[`03-boundary-enforcement.md`](03-boundary-enforcement.md)）。

---

## ディレクトリ構成

```text
drizzle.config.ts       # drizzle-kit の設定（orval.config.ts と同じくルートに置く）
db/                     # マイグレータと成果物。アプリではないので src/ の外
schema/                 # TypeSpec による API 契約（OpenAPI 3.1 を出力）
src/
├─ main.ts              # エントリ（Bun）。本番の Layer から runtime を作り app に注入
├─ app.ts               # コンテキストをパスにマウントするだけ（1 コンテキスト 1 行）
├─ app-runtime.ts       # 合成ルート。各 *-layer.ts を束ねる（contexts を知る唯一の層）
├─ contexts/            # 境界づけられたコンテキスト単位で縦に切る
│  └─ <context>/        #   例: user / auth
│     ├─ <ctx>-layer.ts   #   提供側: このコンテキストの実装（infrastructure を知る）
│     ├─ <ctx>-runtime.ts #   要求側: 動かすのに必要なサービス（ポートだけを知る）
│     ├─ domain/        #     model/（集約 + value-objects/）, services/（ドメインサービス）, ポート
│     ├─ application/   #     command / query（CQRS）
│     ├─ infrastructure/#     テーブル定義 / リポジトリ実装（domain ↔ DB 変換, Layer）
│     └─ presentation/  #     <ctx>-routes.ts（HTTP 契約の宣言）+ controllers/
├─ shared/
│  ├─ domain/           # 共有カーネル。model/ が語彙（uuid.ts + value-objects/）、
│  │                    #   直下はドメインが環境から得るもの（時刻 / 採番 / ハッシュ化）
│  ├─ application/      # ユースケースの共通部品（orNotFound）。層で切った並びの一員
│  ├─ errors/           # 型付きエラー（Data.TaggedError）
│  ├─ presentation/     # ハンドラ / 検証 / エラー翻訳 / リクエストログ の共通基盤
│  │  └─ constants/     #   API が外に見せる語彙。公開するのが `as const` の表と
│  │                    #   派生型だけのファイルを置く（振る舞いを持つものは直下）
│  └─ infrastructure/   # 実装（Layer）。横断ポートの本番実装と、DB の実行時コード
│     └─ db/           #   接続の Layer と error/（例外を読む・分類する・翻訳する）
├─ __mocks__/           # テスト用の偽の実装と固定値（本番コードからは参照しない）
└─ generated/           # orval が OpenAPI から生成（gitignore, prepare で再生成）
docs/                   # 設計と学びの記録
```

要点を先に挙げると:

- **依存の向きは常に内向き。** 「どの実装を使うか」を知るのは `src/app-runtime.ts`（合成ルート）だけ。
  controller は `createApp(runtime)` 経由でランタイムを受け取るため、テストでは Layer を
  差し替えて DB なしで HTTP 境界ごと検証できる。
- **コンテキストを跨ぐ参照はポート（`domain/`・`application/` の interface）に限る。**
  他コンテキストの `infrastructure/` は直接 import しない。書き込みは必ず所有コンテキストの
  command を通す。
- **バレル（再エクスポート専用の `index.ts`）は置かない**（`src` 配下に 0 個）。
  代わりにエクスポート名を単体で読める形にする（`UserId` / `createUser` / `UserRepositoryLive`）。
- **上記はすべて lint で強制している。** 破ると `pnpm lint:fix` が落ちる
  （[`03-boundary-enforcement.md`](03-boundary-enforcement.md)）。

以下、それぞれの判断の理由。

---

## なぜ `features/` ではなく `contexts/` か

**コンテキストどうしが関係を持つのを前提にするため。**

フロントエンド（React 等）でよく使う `features/` は「独立した機能の縦切り」という含意が強い。
バックエンドでは `auth` が `user` を参照するような**跨ぎが必ず起きる**ので、その含意は嘘になる。

`contexts/`（境界づけられたコンテキスト）なら、DDD の文脈マッピングで関係を説明できる。
例: `auth → user` は Customer/Supplier（使う側の要求を、供給側がポートとして公開する）。

跨ぐこと自体は禁止しない。**跨ぎ方だけ**を縛る — 参照してよいのはポート
（`domain/`・`application/` の interface）だけで、他コンテキストの `infrastructure/` や
`presentation/` は触らない。書き込み（集約の変更）は必ず所有コンテキストの command を通す。

---

## バレルを置かない

**再エクスポート専用の `index.ts` は `src` 配下に 0 個。**

置かない理由:

- **import 経路が二重化する。** 実際、バレルがあった頃は `domain/user-repository.ts` だけが
  `./model/user` を直接参照し、他は `./model`（バレル）を経由していた。同じ型に 2 本の道ができる。
- **`export *` が公開面を隠す。** 何がどこから来ているのかが import 文だけでは読めなくなる。

ディレクトリは「公開 API」ではなく、**単なる置き場所**として扱う。

### 代わりに、エクスポート名を単体で読める形にする

バレルが無いぶん、名前空間（`import * as User`）で文脈を補えない。名前自体に文脈を持たせる。

```ts
User / UserId / UserName / UserHashedPassword / createUser / changeUserProfile;
```

修飾しないと、コンテキストが増えたとき `Id` や `Model` が衝突して別名 import 地獄になる。

**ファイル名は主となるエクスポート名に対応させる**（`value-objects/user-id.ts` → `UserId`）。
同じユースケースに属する型は同じファイルに同居してよい
（`create-user-command.ts` → `createUserCommand` / `CreateUserCommandInput` /
`CreateUserCommandOutput`）。名前に接頭辞が付いているので、どれがどのファイルかは名前で読める。

### ただしタグ文字列は一致させなくてよい

brand / DI / エラーのタグは、**グローバル一意でありさえすればよい識別子**。
型解決には関与しないので、読みやすい表記を自由に選べる。

```ts
export const UserId = Uuid.pipe(Schema.brand("User.Id"));
//           ^^^^^^ エクスポート名は修飾            ^^^^^^^ タグはドット区切りのまま
```

---

## `infrastructure/` の命名

**何であるかによって修飾の仕方を変える。**

### ポートの実装 → 「ポート名 + `Live`」

```text
domain/user-repository.ts              ポート
infrastructure/user-repository-live.ts 実装（export: UserRepositoryLive）
```

ポートと実装がまったく同じファイル名になるのを避ける（エディタのファイル検索で見分けがつかない）。
かつ、ファイル名＝エクスポート名の規約も保てる — `UserRepositoryLive` を kebab 化すると
そのまま `user-repository-live.ts` になる。

`Live` は本番用 Layer を指す Effect の慣習で、`PasswordHasherLive` などと語が揃う。

### ポートを持たない技術固有の資産 → 「技術名」

```text
infrastructure/drizzle-schema.ts   テーブル定義（export: tUser）
```

抽象の裏に隠れていない Drizzle むき出しの資産であること、および `schema` という語が
このリポジトリで多義であることの両方に対処する:

| 「schema」が指すもの                  | 場所                       |
| ------------------------------------- | -------------------------- |
| API 契約（TypeSpec）                  | リポジトリ直下の `schema/` |
| Effect Schema（値オブジェクト・検証） | `src` の多数のファイル     |
| 生成された Effect Schema              | `src/generated/`           |
| ネームスペース                        | PostgreSQL の用語          |

### 失敗の翻訳 → 「`handle` + 何を」

**各層には「失敗をその層の語彙へ直す窓口」がある。** 名前を揃えて、構造が読めるようにする。

| 名前                           | 層             | 何を何に直すか                                 |
| ------------------------------ | -------------- | ---------------------------------------------- |
| `handleDbFailure`              | infrastructure | DB 例外 → `RepositoryError`                    |
| `handleMailAddressDuplication` | infrastructure | 一意制約違反 → `MailAddressAlreadyExistsError` |
| `handleErrorResponse`          | presentation   | `ApplicationError` → HTTP 応答                 |

`handleDbFailure` は当初 `dbQuery` という名前で、Promise を作る関数を受け取るラッパだった。
**名前が引数を説明していて、自分の仕事を説明していなかった**ため改めた。
`try` は渡されたものを素通しするだけで、存在理由は `catch` 側にしかない。

同じ理由で `write`（書き込みを包んで 409 に翻訳する）も改めた。あれは
`updatePassword` や `deleteById` も「書き込み」なのに使っておらず、
**そのズレをコメントで釈明していた**。コメントで名前を弁解し始めたら名前が負けている。

`handleMailAddressDuplication` はドメインサービスの `checkMailAddressDuplication` と
**名詞を揃えてある**。動詞だけが違う（書く前に確かめる / すり抜けたものを捕まえる）ので、
二段構えの設計が名前だけで読める。

### 翻訳はラッパではなく pipe の段に並べる

```ts
Effect.tryPromise(() => db.update(tUser).set({ ... }).where(...)).pipe(
  handleDbFailure,                     // DB 例外 → RepositoryError
  handleMailAddressDuplication(user),  // 一意制約違反 → 409
  Effect.asVoid,
);
```

`handleDbFailure` は当初 `Effect.tryPromise` を内側に隠すラッパだった。やめた理由は、
**汎用の翻訳だけがラッパになり、集約固有の翻訳が pipe になる**という食い違いが生まれるから。
同じ「失敗の翻訳」なのに形が 2 種類あると、名前を揃えた意味が薄れる。
持ち上げ → 翻訳 → 翻訳、と並べば読む順と処理の順が一致する。

呼び出し側に `Effect.tryPromise` が出てくるが、これは infrastructure の中だけの話で
外へは波及しない。ポートが宣言する失敗は変わらず `RepositoryError` のままで、
application も presentation も影響を受けない。

**`Effect.tryPromise` が受け取るのは Promise ではなく「Promise を作る関数」であること**は
崩さない。Promise を直接渡すと、Effect を組み立てた時点でクエリが走り出し、
「Effect は実行ではなく手順書」という前提が壊れる。加えてリトライが効かなくなる
（同じ Promise を await し直しても結果は変わらない）。
`RepositoryFailure.Contention` を「リトライで直りうる」と分類している以上、これは他人事ではない。

`handleDbFailure` が `UnknownException` から `error` を取り出して渡しているのは、
`classifyDbFailure` と `isSqlStateViolation` が `cause` を辿って PostgresError を探すため。
包みを増やさず、ドライバが投げた例外そのものを渡している。

`handleWithEffect` だけは `handle` + **どうやって**で、Hono のハンドラを組み立てる側。
形が違うが、そもそも別種のものなので揃えない。

> `validate*` を presentation に予約したのとは扱いが違う。あちらは同じ語が層をまたぐと
> 別の意味になってしまうので分けた。`handle` は**どの層でも「失敗をその層の言葉に直す」**で
> 意味が割れないため、層をまたいで使う。

### presentation は `<ctx>-routes.ts` と `controllers/` に分ける

```text
presentation/
├─ <ctx>-routes.ts     契約の宣言（パス・スキーマ・ステータス）
└─ controllers/        エンドポイント 1 本ぶんの繋ぎ
   └─ __tests__/
```

**種類が違うものを並べない。** routes は「この コンテキストが HTTP に何を見せるか」の
一覧で、controller は 1 本ぶんの数行。フラットに置くと、ファイル一覧で
どれが入口か読めない。`domain/` が同じ形をしている（ポートが直下、`model/` と
`services/` が下）ので、層をまたいで揃う。

`<ctx>-routes.ts` を `contexts/<ctx>/` 直下（`<ctx>-layer.ts` の隣）へ出す案は退けた。
語感は揃うが、**あそこは実装を知ってよい区画**として定義してある（`PORT_SIDE` の外）。
移すと routes が `infrastructure/` を掴んでも誰も咎めなくなる — 実際に動かして測ると、
わざと `UserRepositoryLive` を掴ませたときの検出が **10 件から 0 件**になった。
`~/generated` の参照も両方の lint に弾かれるので、穴を開ける必要も生じる。

---

## テーブル定義は所有するコンテキストが持つ

共有の 1 ファイル（かつての `shared/db/schema.ts`）に全テーブルを集約するのをやめ、
`contexts/<context>/infrastructure/drizzle-schema.ts` に分けた。

**集約（`User`）と保存先（`t_user`）の所有者を揃えるため。** 共有の 1 ファイルに集約すると、
他コンテキストが `db.update(tUser)` を直接書けてしまい、「書き込みは所有コンテキストの
command を通す」という規約を構造が何も守らなくなる。分けておけば越境が import 文に現れ、
lint で機械的に禁じられる。

**物理 DB とマイグレーションは 1 つのまま**（リポジトリ直下の `db/`）。drizzle-kit の `schema` は
glob を取れるため、ファイルを分けても migration は 1 系列で管理できる。
詳細は [`01-database.md`](01-database.md)。

---

## DB 接続も Layer で注入する

`shared/infrastructure/db/client.ts` は当初、モジュールのトップレベルで作った singleton を
`export const db` していた。アダプタ（`*-live.ts`）はそれを直接 `import` していたので、
このリポジトリで**唯一 DI から外れている場所**だった。これを `Database` タグに変え、
`Layer.scoped` で供給する形にした。

得たものは 3 つ。

1. **接続の生成が `import` の副作用でなくなった。** 以前はモジュールが読まれた瞬間に
   接続が作られていた。テストで差し替える口も、閉じる口も無い。
2. **後始末ができる。** `Layer.scoped` + `Effect.acquireRelease` にしたので、
   ランタイムの破棄に合わせて `$client.close()` が走る（引数なしの `close` は
   実行中のクエリの完了を待つ）。実 DB で確認済み — `pg_stat_activity` を
   **コンテナ側の psql から**観測すると、接続は 1 → 11（Bun.SQL のプールが 10 本開く）→
   `dispose()` 直後に 1、とプロセスが生きたまま戻る。
   なお計測をアプリのプロセス内でやろうとすると `Bun.SQL` の probe 自身がプールを広げ、
   **測定器がノイズ源になる**（最大 9 本まで増えた）。外から数えること。
3. **接続情報を `Config` から読めるようになった。** 後述。

`Database` の型からは `$client` を落としている。接続の後始末は `client.ts` の責務であり、
利用側に drizzle を迂回してドライバを直接触る余地を残さないため。

ポートと実装を**同じファイルに置いている**のは、`shared/domain` と `shared/infrastructure`
を分けた理由がここには当てはまらないから。あちらを分けたのは、ポートを import しただけで
実装の依存まで引きずり込むのを避けるためだった。`Database` はドメインが要求するポートではなく
**アダプタを組み立てるための資材**で、置き場も `shared/infrastructure/db/` の中にある。
参照できるのが元から「実装を知ってよい側」だけなので、同居させてもポート側へ経路が伸びない。

合成ルートでは `mergeAll` に並べず `Layer.provide` で与えている。

```ts
Layer.mergeAll(UserLayer, PasswordHasherLive, UuidGeneratorLive).pipe(
  Layer.provide(DatabaseLive),
);
```

こうすると `Database` はアダプタの要求を満たしたところで**外から見えなくなる**
（`AppServices` に現れない）。DB 接続はアダプタを組み立てるための資材であって、
application や presentation が受け取ってよいサービスではない。`mergeAll` に並べると
誰でも `yield*` できてしまう。`provide` は Layer を一度だけ構築して共有するため、
接続も 1 つで済む。

### ランタイムは起動時に構築しきる

`ManagedRuntime.make(AppLayer)` は**遅延構築**で、最初に Effect を走らせるまで
Layer を組み立てない。そのため `main.ts` で `await runtime.runtime()` を挟んでいる。

これが無いと、接続情報の不足に**最初のリクエストまで気付けない**。
実際に `DATABASE_URL` を外して確かめたところ、サーバは正常に起動し、
最初のリクエストで 500 が返った。しかもその失敗は `handleWithEffect` の外側で起きるため、
**契約どおりの本文（`errorCode` / `message`）すら返らない**素の
`Internal Server Error` だった。

つまり `process.env.DATABASE_URL!` を `Config` に置き換えるだけでは、
「起動は成功、リクエストで死ぬ」という壊れ方は何も変わらない。
**設定を読む場所ではなく、Layer をいつ構築するかが効いている。**
`await` を入れた後は起動時に exit 1 で落ち、ポートは開かない。

なお `Config.redacted` を使っているので、失敗メッセージの値は `<redacted>` になる
（接続文字列にはパスワードが入るため）。どの変数が足りないかは出るので困らない。

---

## ユースケースの入出力は、そのコマンド／クエリと同じファイルに置く

`application/` は **1 ファイル = 1 ユースケース**。入出力の型を集めた `dto.ts` を
一度は置いたが、畳んでそれぞれのコマンド／クエリへ展開した。

理由は、`dto.ts` が**この層で唯一の例外**だったから。ユースケースが増えるほど
「入力を直すのに 2 ファイル開く」が積み上がり、逆に `dto.ts` を開いても
どのユースケースの話かは名前でしか分からない。
凝集の単位はユースケースであって「DTO であること」ではない。

副産物として `application/` に補助的なファイルを置く言い訳が消えた。
共通部品（`orNotFound`）を `shared/application/` に出したのはこの規則を保つため。

入力と出力で作りが異なる点は変わらない。

- **入力**は Effect Schema で定義する。値オブジェクトのスキーマを組み合わせるため、
  presentation は生の入力を一度 `decodeInput` するだけで検証済みの値を得られる
  （フィールドごとの詰め替えが要らない）。
- **出力**はプレーンな型で定義する。既に検証済みの値を返すだけで decode は不要だし、
  応答が契約を満たすかは presentation 層が生成スキーマで検証するので二重に検証しない。

応答ボディの「形」（`{ id: ... }` のようなラップ）は契約側の関心なので持ち込まない。
presentation が契約の形へ詰め替える。

---

## ポートは、それを要求する層に置く

`Context.Tag` で宣言するポートは、**それを必要とする層の中**に置く。実装だけが
`infrastructure/` に出る。`domain-not-to-outer` の違反メッセージに書いてあるとおり
「必要なのが副作用なら `domain/` にポートを定義し、実装は `infrastructure/` に置いて
`Layer` で注入する」——この規約はコンテキストの中でも `shared/` でも同じ。

```text
contexts/user/domain/                shared/domain/
├─ model/              語彙          ├─ model/               語彙
│  ├─ user.ts                        │  ├─ uuid.ts
│  └─ value-objects/                 │  └─ value-objects/
├─ services/           業務ルール    ├─ clock.ts             ┐
└─ user-repository.ts  ← 直下        ├─ password-hasher.ts   ├ ← 直下
                                     └─ uuid-generator.ts    ┘
```

**規約は 1 行で言える** — `model/` は語彙、`services/` は業務ルール、
**直下に置かれるのはドメインが環境から得るもの**。`contexts/<ctx>/domain/` で
`user-repository.ts` が直下に転がっているのと同じ枠で、`shared/` 側もそれに揃えた。

### 「ポート」という語について

`Context.Tag` で宣言するものを、このリポジトリでは散文で「ポート」と呼ぶ。
ただし**これはヘキサゴナルアーキテクチャ（Ports and Adapters）の語彙**であって、
DDD でも Effect でもない。Effect 自身は **Service**（部品）/ **Tag**（識別子）/
**Layer**（構築）と呼び、`R` は requirements。

| このリポジトリ | Effect         | ヘキサゴナル |
| -------------- | -------------- | ------------ |
| ポート         | Service（Tag） | Port         |
| `*Live`        | Layer          | Adapter      |
| 依存           | Requirements   | —            |

**説明の言葉として借りるのは構わないが、ディレクトリ名にはしない。**
散文の「ポート」は読み手の理解を助けるだけだが、ディレクトリ名にすると
「全員がそこへ物を仕分ける基準」になる。基準は自分たちの語彙
（DDD の `model` / `services` / `value-objects`）で持つ。

そのため `shared/domain/ports/` は作らず、直下に置いて
「直下 = 環境から得るもの」という位置で語らせている。
`clock.ts` が Tag を宣言していない（時刻の抽象化は Effect の `Clock` が持つ）ことも、
この分け方なら例外にならない。**Tag の有無は「どうやって」の話**で、
「何であるか」の分類軸には使わない。

横断サービス（時刻・採番・ハッシュ化）は当初 `shared/services/` に置いていたが、
`shared/domain/` に移した。理由は 2 つ。

1. **3 つとも `contexts/<ctx>/domain/` から使われている。** 時刻と採番は集約の生成に、
   ハッシュ照合は `verifyUserPassword` に要る。ドメインが要求するものを
   ドメインの外に置いていたことになる。
2. **`services` が層でもトピックでもない名前だった。** これを畳むと `shared/` の直下は
   層の名前 4 つ（domain / application / infrastructure / presentation）と
   トピック 2 つ（errors / db）だけになる。

`shared/domain/services/` にしなかったのは、`services` が 2 つの意味を持ってしまうから。
コンテキスト側の `domain/services/` は**集約をまたぐ業務ルール**の置き場で、技術ポートとは
別物。そしてその枠は、`auth` が来て「コンテキストをまたぐ業務ルール」が現れたときのために
空けておきたい。

> 以前は逆の判断をしていた（「共有カーネルは Schema だけに依存する純粋な語彙で揃える」）。
> 覆した理由は、`contexts/<ctx>/domain/` が最初から語彙（`model/`）と
> R を持つポート（`user-repository.ts`）を同居させており、**その混在こそが既定の形**
> だったから。「純粋な語彙だけ」は原則ではなく、当時の中身の説明にすぎなかった。

### `model/` の中は brand の有無で分ける

| 中身                       | 見分け方                     | 置き場                 | 例                         |
| -------------------------- | ---------------------------- | ---------------------- | -------------------------- |
| **語彙**（値オブジェクト） | `Schema.brand` を持つ        | `model/value-objects/` | `MailAddress` / `Password` |
| **形式**（語彙の素材）     | Schema だが brand を持たない | `model/` 直下          | `Uuid`                     |

`Uuid` は **refinement（制約）だけを持ち、brand を持たない**スキーマなので、
`value-objects/` には入れていない。

```ts
Uuid        = Schema.String.pipe(Schema.pattern(...));                    // 制約のみ
MailAddress = Schema.String.pipe(Schema.pattern(...), Schema.brand(...)); // 制約 + 名目型
```

**制約は「この文字列がどういう形か」を言い、brand は「これが何者か」を言う。**
`Uuid` は形しか言っていないので、単体では何の id かを意味しない。`UserId` と
`OrderId` は同じ形の別物で、その「別物」を作っているのは brand のほう
（`UserId = Uuid.pipe(Schema.brand("User.Id"))`）。

`Uuid` 自身に brand を付けないのはそのため。付けると brand の二重掛けになり、
かつ素の `Uuid` が id を期待する場所へ流れ込めてしまう。

形式が 1 つしかないうちはディレクトリを切らない。上の 2 つを見れば分類できるので、
ディレクトリに分類を語らせる必要がないため。2 つ目の「brand を持たないスキーマ」が
現れたら、そのとき `formats/` なりを切る。

---

## 読み取りと書き込みは、経路を混ぜない

CQRS を採ると自然に湧く問いが 2 つあり、どちらも**答えは「混ぜない」**。
実際に 2 つとも読んでいて引っかかったので、理由を残す。

### command から QueryService を呼ばない

command は `userRepository.findById()` で対象を読む。「ただの取得なら
`GetUserQueryService` でよいのでは」と見えるが、**2 つは別物**。

まず技術的に、3 つのコマンドのうち 2 つは**そもそも不可能**。
`GetUserQueryOutput` は `GET /users/{id}` の契約に合わせて `name` と
`mailAddress` だけに絞った射影で、**`id` も `hashedPassword` も `createdAt` も無い**。

- `updateUserCommand` — `changeUserProfile` は `{...user, name, mailAddress}` で
  他の項目を引き継ぐので、集約が丸ごと要る
- `changePasswordCommand` — `verifyUserPassword` が `user.hashedPassword` を読む

つまり command がやっているのは「取得」ではなく**集約の復元**で、
読んだ結果をそのまま状態遷移の材料にしている。

`deleteUserCommand` だけは存在確認しかしておらず、技術的には置き換えられる。
それでもやらないのは、**2 つのモデルが変わる理由と一貫性のレベルが違う**から。

|                  | Command 側（Repository） | Query 側（QueryService） |
| ---------------- | ------------------------ | ------------------------ |
| 返すもの         | 集約（不変条件を持つ）   | 射影（契約に合わせた形） |
| 変わる理由       | 業務ルール               | **API 契約**             |
| 求められる一貫性 | **強い**                 | 遅れてよい               |

読み取り側に依存すると、`GET /users/{id}` の応答から項目を減らしただけで
削除のユースケースが壊れる。**プレゼンテーションの都合が書き込みの正しさに波及する**。
将来リードレプリカへ向ければ、レプリケーション遅延で「まだ居る」と判定してから
primary に DELETE を投げることにもなる。**読み取りモデルは遅れてよいという前提で
作ったものを、遅れが許されない判断に使ってはいけない。**

CQRS が分けているのは「読む / 書く」という動詞ではなく**モデル**であって、
リポジトリから読むのは書き込み側の操作である、と考えると迷わない。

### リポジトリは `Option` を返し、404 を決めない

`findById` が `Option` を返すので、呼ぶ側が `orNotFound` を挟んでいる。
「リポジトリが `ResourceNotFoundError` にすればよいのでは」と見えるが、
**同じ「見つからない」が呼ぶ側ごとに違う意味を持つ**。

| 呼ぶ側                                         | 「見つからない」の意味      |
| ---------------------------------------------- | --------------------------- |
| `updateUser` / `deleteUser` / `changePassword` | 404                         |
| `checkMailAddressDuplication`                  | **成功**（重複なし）        |
| `login`（auth で実装予定）                     | **401**（存在を漏らさない） |

2 行目は既にコードにある。`checkMailAddressDuplication` は `Option.none` を
「重複なし」として素通りさせており、リポジトリが 404 を投げていたら
**catch して成功に戻す**羽目になる。エラーを投げて即座に握り潰すのは設計が
間違っているサイン。

3 行目は `auth` で必ず踏む。ログインで「そのメールアドレスは登録されていません」と
返してはいけない（アカウント列挙を許す）ので、401 に丸める必要がある。

**「見つからない」は事実で、「404」は方針。** 事実を報告するのがリポジトリ、
方針を決めるのがユースケース。`Option` はその事実を正直に表した型で、
方針は [`orNotFound`](../src/shared/application/or-not-found.ts) が名前を持って担う。
リポジトリが決めてしまうと、アダプタがユースケースの方針を決めることになる。

型の上でも損をする。`UserRepository` は `domain/` のポートなので、
`ResourceNotFoundError` を載せると重複チェックのシグネチャにまで
「404 で失敗しうる」と書かれる — 実際には失敗しないのに。

> `find*` は `Option`、`get*` は失敗する、という命名で両方を生やす流儀もあるが採らない。
> 同じクエリのメソッドが 2 つに増えるわりに、消せるのは `.pipe(orNotFound)` の
> 1 行 × 3 箇所だけ。`orNotFound` は Query 経路（`getUserController`）でも使うため、
> どのみち残る。

---

## 書き込みポートは、集約ではなく状態遷移に対応させる

`UserRepository` の更新系は、ドメインの状態遷移と 1 対 1 に並べる。

```text
createUser          → create
changeUserProfile   → updateProfile    （name / mailAddress / updatedAt を書く）
changeUserPassword  → updatePassword   （hashedPassword / updatedAt を書く）
```

集約まるごとを書く `update` を 1 つ持っていたが、**その操作が変えないはずの列まで
書き戻していた**。集約を読んでから書くまでの間に他の誰かがプロフィールを変えていれば、
パスワード変更がそれを巻き戻す（ロストアップデート）。逆向きも同様で、
プロフィール更新が変更直後のパスワードを古いハッシュへ戻しうる。**後者は
「漏れたから変えた」パスワードが黙って復活する**という、より危険な形になる。

実 DB で再現させて確認した。`changePassword` は argon2 の照合とハッシュで
100ms 前後かかるため、その最中にプロフィールを更新すると再現する。
分けたあとは巻き戻らない。発行される SQL も互いの列に触れていない。

副産物として、**失敗の型が操作ごとに正確になる**。メールアドレスを書かない
`updatePassword` に一意制約違反は起こりえず、`E` にも現れない。分ける前は
「起こりえないが型には出る 409」を `Effect.die` で潰す必要があり、
なぜ潰すのかという説明をコメントで背負っていた。**型が嘘をつくのをやめれば、
その説明ごと消える。**

### 残る穴と、その引き金

同じ列への同時更新は後勝ちのまま（同時に 2 回パスワードを変えたら片方が勝つ）。
検出するにはバージョン列（楽観ロック）が要る。今それを入れないのは、
**列単位に書き分けている限り、守るべき不変条件が列をまたがないから**。

見直す引き金は「複数の列にまたがる不変条件ができたとき」。
そうなると列ごとの書き分けでは整合を守れず、集約単位の排他が要る
（詳細は [`04-backlog.md`](04-backlog.md)）。

---

## ドメインサービス（`domain/services/`）

**集約をまたぐ業務ルール**を置く。集約 1 つを見ても判断できない不変条件は、
エンティティにも値オブジェクトにも属さないため（Evans の Service の定義）。

例: `checkMailAddressDuplication` —「同じメールアドレスのユーザーは 2 人存在しない」。
`User` 集約 1 つを見ても「他に同じメアドの人が居るか」は判断できない。

ルールに名前を与えて 1 箇所に集め、**「呼ぶ順序」だけを command に残す**。
依存するのは `domain/` のポートだけなので、層の向きは内向きのまま保たれる
（I/O を伴うことは戻り値の `R` に現れる）。

### command に残すもの

「対象が居なければ 404」のような**ユースケースごとの方針**は command に残す。
これは業務ルールではない — ビジネス側に「同じメアドの人が 2 人居ていいですか？」は聞けるが、
「存在しない ID を指定されたらどうしますか？」は業務の問いではない。

この「Option を 404 に変える」は 3 箇所（`updateUser` / `deleteUser` / `changePassword`）に
現れたため `shared/application/or-not-found.ts` に切り出した。
`findUserOrFail`（リポジトリを内側に持つ形）にしなかったのは、それだと
コマンド経路しか吸収できず、同じ形の判断をしている `getUserController`（Query 経路）が
残ってしまうから。変換だけを切り出せば経路を問わず使え、
結果として user コンテキスト固有でもなくなる。

### 業務ルールでも、集約に置くもの

ドメインサービスは「エンティティにも値オブジェクトにも属さない操作」の受け皿であって、
**業務ルールの既定の置き場ではない**。単一の集約を見れば答えが出る問いは集約に置く。

例: `verifyUserPassword`（渡された平文が、このユーザーの現在のパスワードか）。
これはビジネス側に聞ける問い（「パスワード変更時に現在のパスワードを確認しますか？」）
なので業務ルールだが、`User` 1 つを見れば判定できるためドメインサービスにはしない。

判断の順序はこうなる。

1. ビジネス側に聞ける問いか → いいえなら command（ユースケースの方針）
2. 集約 1 つを見て答えられるか → はいなら集約（`domain/model/`）
3. どちらでもない（集約をまたぐ）→ ドメインサービス（`domain/services/`）

技術サービス（`PasswordHasher`）が要るかどうかは判断材料にしない。
`createUser` が `UuidGenerator` を、`changeUserProfile` が `Clock` を要求するのと同じく、
必要な副作用は戻り値の `R` に現れるだけで、置き場所を変える理由にはならない。

### 命名: `check<対象>Duplication`

一意性の検証はこの形に統一する（例: `checkMailAddressDuplication`）。

- 失敗するかどうか・何で失敗するかは **Effect の型（`E` チャネル）が語る**ので、
  名前は「何を見るか」だけを言う。`ensure` は .NET/Rust では「満たさなければ落とす」だが
  Go/k8s では「無ければ作る」を意味し、さらに Effect には別物の `ensuring`
  （ファイナライザ）があるため避けた。
- `validate*` は presentation 層の契約スキーマ検証（`validateJson` / `validateParams`）で
  使うため避ける。

### 一意性は事前チェックと DB 制約の二段構えで守る

`checkMailAddressDuplication`（ドメインサービス）と、`UserRepositoryLive` の `handleMailAddressDuplication`
（一意制約違反 → `MailAddressAlreadyExistsError`）は**どちらも 409 を出す**。
重複に見えるが、**役割が違うので両方要る**。

|                                | 役割                                     | いつ効くか        |
| ------------------------------ | ---------------------------------------- | ----------------- |
| `checkMailAddressDuplication`  | 業務ルールをドメインで表明し、安く答える | 普段（実質 100%） |
| `handleMailAddressDuplication` | 同時実行でも契約どおりの 409 を返す      | 競合時のみ        |

事前チェックは**読んでから書くまでに隙間がある**（TOCTOU）。しかも `createUser` は
チェックの後に argon2id のハッシュ化を挟むため、**窓が 100ms 前後まで開く**。
送信ボタンの二重クリックや、届いていたリクエストのリトライで普通に踏める幅で、
「同じ瞬間」である必要はない。

実測（同一メールアドレスで同時に 10 リクエスト）:
**事前チェックで弾かれたのは 0 件**、DB 制約で弾かれたのが 9 件。
10 本とも「重複なし」と判定されてから INSERT で衝突している。

だから**正しさを保証しているのは制約のほう**で、事前チェックは速く親切に答えるためのもの。
アプリ側のロックでは代替できない（本番は複数タスクで動くため、
全インスタンスをまたいで唯一性を保証できるのは共有している DB だけ）。

逆に、どちらか一方を消すとこうなる。

- **`handleMailAddressDuplication` を消す**: データは守られるが、競合時の応答が 409 から 500 に劣化する。
  契約違反であり、クライアントは「入力を直す」べきか「再試行する」べきかを判断できない。
- **事前チェックを消す**: 業務ルールの記述がマイグレーションの SQL だけになり、
  ドメインを読んでも「同じメールアドレスの人は 2 人いない」が分からなくなる。
  加えて、重複と分かるまでに毎回 argon2id を焼くことになる。

なお `updatePassword` の `E` に `MailAddressAlreadyExistsError` が無いのは、
あれがメールアドレスを書かないため。触らない列の制約違反は起こりえない。
書き込みポートを状態遷移ごとに分けた効果がここにも出ている。

---

## テストは 2 種類に分け、対象の隣に置く

**単体テスト**（モジュール単位）と **API テスト**（エンドポイント単位）で分ける。
どちらも対象と同階層の `__tests__/` に置く。

```text
src/contexts/auth/domain/model/__tests__/refresh-token.test.ts       単体
src/contexts/user/presentation/controllers/__tests__/get-user-controller.test.ts API
src/shared/presentation/__tests__/verify-bearer.test.ts              API（横断）
src/__mocks__/                                                       テストの資材
```

```jsonc
"test":     "bun test --path-ignore-patterns \"**/presentation/**\"",  // 単体
"test:api": "bun test presentation",                                    // API
```

### controller の単体テストは書かない

controller は「検証済みの入力を組み立て、ユースケースを呼ぶ」だけの数行しかない。
偽の command を注入して「呼ばれたこと」を確かめても、守れるものが無い。

代わりに **エンドポイント越しに叩く**。`createApp` にテスト用のランタイムを渡すと、
偽物になるのは**ポートの実装だけ**で、その内側は全部本物が動く。

```text
routes（契約検証）→ controller → command → domain → ポート
                                                      ↑ ここだけ偽物
```

だから 1 ケースで `handleWithEffect` の契約検証・`decodeInput` の値オブジェクト変換・
ドメインの業務ルール・`handleErrorResponse` のエラー翻訳・応答スキーマの検証まで
まとめて通る。**ファイル名と describe は controller に合わせるが、試しているのは
エンドポイント**であって controller 単体ではない。

この形の強さは実証済みで、プレゼンテーション層を 13 段階作り替えても、
`Database` を Layer 化しても、`shared/db` を丸ごと移動しても、
HTTP 境界のテストは 1 行も変えずに通り続けた。**契約は動かないので縫い目も動かない。**

### describe の表題はモジュールの `.name`

```ts
describe(classifyRefreshToken.name, ...)  // 単体
describe(loginController.name, ...)       // API
```

単体でも API でも同じ規則にする。表題は「**このファイルが何についてのファイルか**」で、
リネームに追従してほしいもの。文字列で書くと、リネーム後も表題だけ古い名前で残る。

API 側を `"POST /auth/login"` と書く案は退けた。読み物としては勝るが、
**エンドポイントは request ヘルパーに 1 箇所だけ書いてある**ので表題で重ねる必要がなく、
規則が 2 本に割れるほうの損が大きい。

**`.name` を使ってよいのは関数のエクスポートだけ。** 値オブジェクトや集約の
スキーマに使うと `"TypeLiteralClass"` という別物が表題になる — `Schema.Struct` が
クラスを返すためで、**TS も止めてくれない**（型は `string` で通る）。
`as const` の表と Effect の値は object なので TS2339 で弾かれる。

しかも bun は通ったテストの名前を出さないので、**失敗するまで気付けない**。
スキーマを対象にするときは文字列で書く。

### ケースの表題は「〜の場合、〜すること」で揃える

```ts
test("猶予期間を 1 ミリ秒でも過ぎた場合、盗難のサインとして reused を返すこと", ...)
test("Bearer が無い場合、401 を返し、失効も走らないこと", ...)
```

**条件と期待をどちらも書かせる**ための型。片方しか書けない表題は、たいてい
テストの中身も曖昧になっている。書けないなら 1 ケースに 2 つ混ざっているサイン。

実際に効いた。旧「猶予期間の境界 (30 秒ちょうど) は内側に含む」は、読むと分かった
気になるが**条件も期待も曖昧**で、境界のどちら側の話なのかも何が返るのかも書いていない。
型に嵌めて初めて「失効からちょうど 30 秒の場合、境界を内側に含めて within-grace を
返すこと」になり、何を守っているかが読めるようになった。

### 正常系 / 異常系 は describe のネストで分ける

```ts
describe(loginController.name, () => {
  const requestBody = { ... } satisfies typeof LoginBody.Encoded;

  describe("正常系", () => { ... });
  describe("異常系", () => { ... });
});
```

表題の接頭辞（`正常系: ...`）にはしない。接頭辞だと表題ごとに同じ語が並ぶが、
階層なら**分類として一度だけ**現れる。失敗時の出力も
`loginController > 異常系 > ...` と読めるようになる。

共通の値（`requestBody` や fixture）は外側の describe に置く。両方から見えるので、
分類のために書き分ける必要はない。

**単体テストはネストしない。** `classifyRefreshToken` の 9 ケースは 5 つの状態を
返し分けるだけで、どれも正常な動作。無理に分けると嘘の分類になる。

### ケースの中身は arrange / act / assert の 3 ブロック

```ts
test("存在しない id の場合、404 を返し、永続化も走らないこと", async () => {
  const updated: User[] = [];
  const runtime = makeRuntime({ ... });   // arrange

  const response = await putUser(runtime, FIXED_UUID, requestBody);  // act

  expect(response.status).toBe(HttpStatus.NotFound);                 // assert
  expect(updated).toStrictEqual([]);
});
```

**空行で 3 つに割るだけで、`// Arrange` のようなラベルは書かない。**
コメントは「なぜ」を書く場所という規約（[CLAUDE.md](../CLAUDE.md)）と衝突するし、
形が揃っていれば区切りは空行で読める。

崩れやすいのは 2 箇所で、どちらも「1 行にまとめると短くて気持ちいい」ために起きる。

```ts
const response = await getUser(makeRuntime(), id); // arrange が act に埋まる
expect(await classifyAtNow(token)).toBe(Usable); // act が assert に埋まる
```

後者がとくに悪い。**失敗したときに「何を実行した結果か」が出力から消える**し、
act の戻り値を 2 回以上検証したくなった瞬間に書き直しになる。

### 横断的な振る舞いは `shared/presentation/__tests__/` へ

「`Authorization` が無ければ 401（認証を要求する 4 本すべて）」のように、
**複数のエンドポイントにまたがるもの**は controller 単位のファイルに置けない。
`handleWithEffect` が共通で担っている振る舞い（相関 ID・defect の受け皿・契約検証）も同じ。

### 実行の分け方は「除外」で書く

`test` は対象を列挙せず、**presentation を除外する**形にしている。
列挙する形にすると、新しい層や置き場を足したときに書き足し忘れる。
しかも **忘れても緑になる**ので気付けない（テストが実行されていないのに成功に見える）。
除外形なら、忘れたときに「余計に実行される」方向に倒れる。

### リクエストのボディは `requestBody` で、契約の `Encoded` 型で縛る

```ts
const requestBody = {
  mailAddress: "login@example.com",
  password: "SuperSecret123!",
} satisfies typeof LoginBody.Encoded;
```

名前は全ファイルで `requestBody` に揃える（かつては `credentials` / `passwordBody` /
`updateBody` / `validBody` と散っていた）。ヘッダを渡す引数も `requestHeaders`。

型は生成スキーマの **`Encoded` 側**を使う。`Type` 側は `S.brand` が付いていて
素のリテラルを受け付けない（TS1360）。`Encoded` はワイヤに載る形そのものなので、
**テストが組み立てたいものと一致する**。

これで契約とのズレが型で止まる:

| 書き間違い                      | 結果                     |
| ------------------------------- | ------------------------ |
| 契約に無いフィールドを足す      | TS2353                   |
| 必須フィールドを落とす          | TS2741                   |
| 契約がフィールド名を変えた      | 次の生成でテストが落ちる |
| `password: "short"`（長さ違反） | **通る** — 精製は実行時  |

最後の行が肝で、`satisfies` が守るのは**形だけ**。値の制約（`minLength` 等）は
実行時の検証なので、そこはテスト本文が 400 を確かめる担当になる。
逆に言えば、400 のケースでわざと不正な値を渡しても型は邪魔をしない。

### 応答の検証は `toStrictEqual`。`toMatchObject` は使わない

```ts
expect(await response.json()).toStrictEqual({
  errorCode: ErrorCode.BadRequest,
  message: ErrorMessage.BadRequest,
  details: [{ field: "password", message: expect.any(String) }],
});
```

`toMatchObject` は**部分一致**なので、「余計なものを返していないこと」を守れない。
API の応答でいちばん怖いのは**余計なフィールドが増えること**（ハッシュ済みパスワードが
混ざる、内部の例外が漏れる）で、部分一致はそれをすべて見逃す。

実際に測ってある。`errorBody` に `extra: 1` を足す変異を入れると、
`toStrictEqual` に替えた後は **35 件中 18 件が落ちる**。替える前は 1 件も落ちなかった。

`message` を `expect.any(String)` で流さないのも同じ理由。文言は
`ErrorMessage` の定数なので**そのまま書ける**。書いておけば、汎用エラーに固有の
文言が紛れ込んだとき（`ErrorMessage` の doc が禁じている状態）に落ちる。

### 例外は `details[].message` だけ

ここだけ `expect.any(String)` を使う。中身は Effect の `ArrayFormatter` が吐く英文
（`Expected a string at least 12 character(s) long, actual "short"`）で、
**こちらが決めた文言ではない**。固定すると Effect を上げるたびに、
振る舞いが何も変わっていないのにテストが落ちる。

守れているのは `field` の値と、`details` の**要素数**。`errors: "all"` で全違反を
集めているので、要素数が固定されることには意味がある（1 つのつもりが 2 つ出ていたら落ちる）。
`expect.any(String)` が素通りではないことも変異で確認済み（`message` を落とすと 7 件落ちる）。

### テストは境界検査の対象外

**検査器が 2 つあるので、両方に同じ穴を開ける。**

- `.dependency-cruiser.mjs` … `exclude: { path: "(__tests__|__mocks__)/" }`
- `.oxlintrc.jsonc` … 最後の override で `no-restricted-imports` を `"off"`

ルールが守っているのは**本番コードの構造**で、テストは元からその外側にいる。

とくに API テストは `createApp` を組み立てるため、合成ルート（`main.ts` /
`app-runtime.ts`）と同じく全アダプタへ経路が繋がる。実際 `presentation/` の下へ
移した瞬間に `no-indirect-path-to-impl` が発火した（あのディレクトリは `PORT_SIDE` に
含まれるため）。**コロケーションを選ぶ以上この除外は必須**で、
`src/__tests__/` に置いていた頃は `src` 直下 = `PORT_SIDE` の外だったので露見しなかった。

oxlint 側は後から気付いた。リクエストのボディを契約の型で縛ろうとしたところ、
`~/generated` の参照が `shared/presentation/__tests__/` で弾かれた。
**契約こそが API テストの試験対象**なので、ここを禁じると
「契約と一致していること」を型で確かめる手段が無くなる。

oxlint は `ignorePatterns` で丸ごと外さない。それだと未使用変数の検出まで消える。
切るのは境界ルールだけで、`overrides` は後勝ちなので**必ず配列の最後に置く**。

除外しすぎていないことは、わざと違反するファイルを 4 つ作って確認した
（本番の `domain` から `~/generated` → 検出 / `__tests__` から → 素通り /
`__tests__` の未使用変数 → 検出）。

### `__mocks__` に入れるもの

偽の実装（`makeRuntime` と偽 Layer）と、それが使う固定値だけ。
**リクエストのヘルパーは置かない** — 分割後はそれぞれ 1 つのテストファイルからしか
使われないので、共有する理由が無い。

`__tests__` にテスト以外を置かないのと同じ理由で、`__mocks__` にもモック以外を置かない。
フィクスチャを別に切る（`__fixtures__`）のは、**モックと無関係に育ってきたとき**でよい。
いまは共有しているのが 120 行ほどなので、フォルダを分ける量ではない。

---

## API 応答を封筒（envelope）で包まない

リソースの内容をそのまま返す。

```jsonc
// 200 GET /users/{id}
{ "name": "取得ユーザー", "mailAddress": "fetched@example.com" }
// 201 POST /users
{ "id": "019fbf41-5fcd-7000-b147-14f2ed63cf2f" }
// エラー
{ "errorCode": "4040", "message": "指定されたユーザーは存在しません" }
```

以前は `result` / `meta` で包んでいたが、`meta` の中身（`respondedAt`）は HTTP の
`Date` ヘッダと重複しており、相関 ID も `X-Request-Id` ヘッダで返しているため、
**封筒が情報を何も足していなかった**。

副産物として、`errorBody` から時刻取得が消えて純粋な関数になり、連鎖して
`handleErrorResponse` も `Effect` を返す必要がなくなった。エラー翻訳はもともと
純粋な対応表（タグ → ステータス + errorCode）で、`Effect` を被っていた唯一の理由が
`respondedAt` の時刻取得だった。

### `createUser` が id を返すこと

CQRS の「コマンドは値を返さない」原則に対する**意図的な例外**。

採番はサーバー側でしか決まらず、返さないとクライアントは作ったリソースを二度と
参照できない（`GET /users/{id}` を呼べない）。集約そのものは外に出さない。

### 失敗の出口は 2 つだけ

応答が契約の形を保つ経路は 2 本しかなく、どちらも `handleWithEffect` にある。

| 失敗の種類                   | 出口                                 | 外に出るもの                 |
| ---------------------------- | ------------------------------------ | ---------------------------- |
| 型付きエラー（`E` チャネル） | `handleErrorResponse` + `logFailure` | 契約の errorCode と定型文    |
| defect（`orDie` / `die`）    | `logDefect` + `defectResponse`       | 契約の 500（原因は出さない） |

**defect は `catchAll` をすり抜ける**ので、受け皿が無いと `runPromise` が reject し、
Hono 既定の平文 `Internal Server Error` が返る。契約と違う形になるうえ、
`logFailure` も走らないので**相関 ID の付いたログが 1 行も残らない**。
「問い合わせ番号からログを引く」という設計が、そこだけ効かなくなる。

受け皿を 1 箇所に置いてあるので、`orDie` はどこで使ってもこの経路を通る
（応答スキーマ違反 / DB 行の復元失敗 / ハッシュ形式の破れ / 起こりえない一意制約違反）。
**「起きたらバグ」を `orDie` で表明してよいのは、この出口があるから。**

### 一覧について

フラットにしても将来の `listUsers` は困らない。一覧は
`{ items: [...], totalCount, currentPage }` のような**それ自体が意味を持つオブジェクト**に
なるので、封筒とは別物（`schema/src/shared/pagination/` の型がそのため）。
