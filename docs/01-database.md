# 01. データベース周りの設計と運用

このプロジェクトの永続化層（Docker / PostgreSQL / Drizzle / マイグレーション）に関する
決定事項と、その **なぜ** を残す。

---

## 全体像：ローカルと本番の分離

| 層     | ローカル                                       | 本番（想定）                       |
| ------ | ---------------------------------------------- | ---------------------------------- |
| DB     | Docker の Postgres 18（`docker-compose.yaml`） | **AWS RDS**（マネージド Postgres） |
| アプリ | mise + Bun でホスト実行                        | **ECS Fargate**（ECR のイメージ）  |

- **`docker-compose.yaml` はローカル専用**。本番の DB はコンテナで動かさず RDS を使う。
  つまり compose の Postgres は「本番の縮小版」ではなく、開発用の使い捨て。
- 本番のアプリは ECR イメージを Fargate で実行する（Dockerfile は別途構築予定）。

---

## PostgreSQL のバージョン選定

- **18 を採用**（2025-09 リリースの安定版。最新パッチ系）。
  - 決め手: `uuidv7()` が **コア関数**として追加され、拡張なしで使える。
- **19 は Beta のため不採用**（本番/開発 DB には非推奨）。
- **alpine を避けた**理由:
  - alpine は musl libc で **locale / 照合順序（collation）対応が限定的**。
  - 本番 RDS は glibc なので、**パリティのため local も glibc（既定の debian 版）に揃える**。
  - DB は stateful でイメージ容量削減の旨味も薄い（一度 pull して使い続ける）。
  - 対比: **stateless なアプリイメージは alpine/slim でOK**（軽量が正義）。使い分ける。

---

## ORM: Drizzle

- **選定理由**: 軽量・SQL に近い・Bun 一級対応。手動マッピングで domain を汚さず、
  永続化モデル↔集約の変換を自分で書けるので DDD と相性が良い。
- **ドライバ**: `drizzle-orm/bun-sql`（Bun ネイティブ SQL）。`pg` / `postgres.js` 等の
  別ドライバ依存が不要。
- TS/npm 対比: Prisma がフルスタック ORM、Drizzle は「型付き knex」的な薄いレイヤ。

---

## ディレクトリ構成

**実行時のコードと、開発・デプロイの道具を、別の場所に置く。**

```text
drizzle.config.ts               # drizzle-kit 設定（orval.config.ts の隣）
db/                             # アプリではないので src/ の外
├─ database-url.ts              #   接続情報の読み取り（未設定なら throw）
├─ migrate.ts                   #   ランタイムマイグレータ（bun-sql）
└─ migrations/                  #   生成 SQL + meta（git 管理）

src/shared/infrastructure/db/   # 実行時に動くコード
├─ client.ts                    #   接続クライアント（bun-sql）の Layer
└─ error/
   ├─ constants/
   │  ├─ sql-state.ts                    # SQLSTATE の語彙
   │  ├─ failure-by-sql-state-class.ts   # クラス → 内訳
   │  └─ failure-by-error-code.ts        # Bun の code → 内訳
   ├─ postgres-error-reader.ts  #   例外を読む / 制約違反を判定
   ├─ classify-db-failure.ts    #   ログ用の内訳へ分類
   └─ handle-db-error.ts      #   失敗を RepositoryError へ翻訳

src/contexts/<context>/infrastructure/
└─ drizzle-schema.ts            # そのコンテキストが所有するテーブル定義
```

- **道具は `src/` の外に出す**。`drizzle.config.ts` はコード生成ツールの設定で、
  同種の `orval.config.ts` がルートにあるのに揃えた。`db/` に入るのはデプロイ時に走る
  スクリプトと生成された成果物で、どちらもアプリのコードではない。
  こうすると **`src/` はアプリだけ**という線が引ける。
  なお `migrate.ts` は本番で動くため、`tsconfig.json` の `include` に `db/**/*.ts` を足して
  型チェックの対象に残してある（`drizzle.config.ts` は開発時にしか動かないので対象外）。
- **実行時のコードは `shared/infrastructure/db/` に置く**。Layer もエラー翻訳も「実装」なので、
  `PasswordHasherLive` などと同じ層に属する。おかげで `shared/` の直下は層の名前だけで揃い、
  境界ルールも `infrastructure` 向けの既存ルールがそのまま効く
  （[`03-boundary-enforcement.md`](03-boundary-enforcement.md#層ごとの可否)）。
- **`db/` はテーブル定義を持たない**。ここに入るのは「物理 DB という 1 つの外部リソース」
  に関する共有物だけ（接続・エラー判定・マイグレーション基盤）。アダプタは各コンテキストにある。
- **テーブル定義は所有するコンテキストの `infrastructure/drizzle-schema.ts` に置く**。集約（`User`）と
  保存先（`t_user`）の所有者を揃えるため。共有の 1 ファイルに集約すると、他コンテキストが
  `db.update(tUser)` を直接書けてしまい、「書き込みは所有コンテキストの command を通す」という
  規約を構造が何も守らなくなる。分けておけば越境が import 文に現れ、lint で機械的に禁じられる。
- **物理 DB とマイグレーションは 1 つのまま**。drizzle-kit の `schema` は glob / 配列を取れるため
  （`"./src/contexts/*/infrastructure/drizzle-schema.ts"`）、ファイルを分けても migration は
  全テーブルをまとめて 1 系列（`out`）で管理できる。
- **コンテキストを跨ぐ参照に FK を張らない**（後述）。
- **ドメインモデル（集約・値オブジェクト）は `contexts/<context>/domain/` に置く**。
  テーブル↔ドメインの変換は同じコンテキストの `infrastructure/` の repository が担う。

### コンテキストを跨ぐ参照に FK を張らない

`t_refresh_token.user_id`（auth 所有）は `t_user.id`（user 所有）を指すが、
**Drizzle でも DB でも外部キー制約は宣言しない**。

制約を張ると「**user コンテキストの削除が auth の都合で失敗する**」という結合が生まれる。
`deleteUser` の時点で券が残っていれば FK 違反で落ちる、という形で、
コンテキストを分けた意味が消える。参照整合性は DB 制約ではなく、
**参照する側（auth）の手順**で保つ — user が消えたら券も片付ける、というルールを
アプリのユースケースとして持つ。将来 DB を分けても壊れない形でもある。

> かつてここには「境界を跨ぐ FK も、相手コンテキストの `drizzle-schema.ts` を
> import すれば書ける（その依存が可視化されるのが利点）」と書いていた。
> **これは `no-cross-context-internals` と両立しない** — あのルールは他コンテキストの
> `infrastructure/` への import をまさに禁じている。`auth` が初のコンテキスト跨ぎで、
> 実際に書こうとするまで矛盾に気付かなかった。2026-08-08 に撤回。

---

## t_user テーブル

| カラム          | 型           | 制約 / 既定                                           |
| --------------- | ------------ | ----------------------------------------------------- |
| id              | uuid         | PRIMARY KEY（**DB DEFAULT なし** = アプリ側採番）     |
| name            | varchar(100) | NOT NULL                                              |
| mail_address    | varchar(255) | NOT NULL（一意性は下記の関数インデックス）            |
| hashed_password | text         | NOT NULL（パスワードのハッシュ。argon2id 想定）       |
| created_at      | timestamptz  | NOT NULL, DEFAULT now()                               |
| updated_at      | timestamptz  | NOT NULL, DEFAULT now()（更新はアプリ側 `$onUpdate`） |

### メールアドレスの一意性は `lower()` に張る

```sql
CREATE UNIQUE INDEX "t_user_mail_address_lower_unique" ON "t_user" USING btree (lower("mail_address"));
```

列に `UNIQUE` を張るとバイト比較になり、`Taro.Yamada@example.co.jp` と
`taro.yamada@example.co.jp` が**別人として両方登録できてしまう**。実運用では同一人物なので、
同じ人が 2 アカウントを持ち、前に使った大小を忘れるとログインできない。

かといって**アプリ側で小文字へ潰すのも選ばなかった**。潰すと利用者が名乗った表記を
復元できず、将来このアドレスへメールを送るとき、届くかどうかを受信サーバの設定に賭ける
ことになる（RFC 5321 §2.4 はドメイン部を大小無視と定める一方、ローカル部については
SMTP 実装に `MUST take care to preserve the case of mailbox local-parts` と要求している）。

**保存は入力どおり・一意判定だけ大小無視**が、両方を満たす唯一の形だった。
判断の経緯は契約側の [`schema/src/shared/model/MailAddress.tsp`](../schema/src/shared/model/MailAddress.tsp) に残してある。
見送った案は「表示用と正規化用で列を分ける」で、2 列の同期という責務が増えるため却下した。

**検索も同じ形で書くこと。** `lower(mail_address) = lower($1)` と書けばこの索引が使われるが、
`mail_address = $1` に戻すと索引に一致せず全表走査になる（`EXPLAIN` で確認済み）。

```
lower(mail_address) = lower(...)  → Index Scan using t_user_mail_address_lower_unique
mail_address = ...                → Seq Scan
```

一意性は索引が保証するので、`lower()` を書き忘れても**重複データは作れない**。
起きるのは「検索がヒットしない」という気付きやすい壊れ方のほう。

#### collation で解決しなかった理由

MySQL ならこの問題は存在しない。照合順序の接尾辞が挙動を決めていて、`_ci`
(case insensitive) の列に素の `UNIQUE KEY` を張るだけで済む。しかも 8.0 の既定が
`utf8mb4_0900_ai_ci` なので、**何もしなくてもそうなる**（むしろ大小を区別するほうが
`_bin` の明示を要する）。ただし `_ai` はアクセントも同一視するため、
`resume@x.com` と `résumé@x.com` が衝突する点は別途注意が要る。

**Postgres にも同等のものはある。** 12 以降の nondeterministic ICU collation で、
18.4 で実際に試したところ MySQL の `_ci` と同じ挙動になった。

```sql
CREATE COLLATION case_insensitive (provider = icu, locale = 'und-u-ks-level2', deterministic = false);
CREATE TABLE t (mail varchar(255) COLLATE case_insensitive NOT NULL UNIQUE);
```

| 確認項目                  | 結果                                   |
| ------------------------- | -------------------------------------- |
| 保存される値              | 入力どおり                             |
| 素の `=` で大小違いを検索 | ヒットする（**`lower()` 不要**）       |
| 素の `UNIQUE` で重複      | 弾く                                   |
| `LIKE '%EXAMPLE%'`        | 効く（大小無視）                       |
| アクセント                | 区別する（MySQL の `_ai_ci` より安全） |

`lower()` の書き忘れという唯一の弱点が消えるので魅力的だが、**採らなかった**。

決め手は性能ではなく **Drizzle が表現できないこと**。`drizzle-orm` の `varchar` に
collation の指定は無く（`pg-core` 全体で collation を扱う箇所が無い）、`drizzle-kit` も
`CREATE COLLATION` を生成しない。手書きマイグレーションで当てることはできるが、
スキーマ定義と DB の実体がずれ、`db:generate` のたびに差分の扱いに悩むことになる。

性能も測った（200,000 行 INSERT / 10,000 回検索、順序を入れ替えて再現確認）。

| 方式                      | INSERT 20 万行 | 検索 1 万回 | 索引サイズ |
| ------------------------- | -------------- | ----------- | ---------- |
| 素の UNIQUE（大小を区別） | 850 ms         | 31 ms       | 17 MB      |
| **`lower()` 関数索引**    | 884 ms         | 95 ms       | 17 MB      |
| ci collation              | 475 ms         | 202 ms      | 17 MB      |

読みは関数索引が collation の 2 倍速く、書きは逆に collation が倍近く速い。
ただし 1 回あたりの差は 10µs 前後で、**ログイン 1 回の実測 70.9ms の 0.03%**。
ログインは argon2id のハッシュ計算が支配的（それが仕事）なので、
どちらを選んでも体感には出ない。**性能は判断材料にならなかった。**

---

## 識別子戦略：アプリ側採番

- **採用**: ドメインの生成ファクトリで **`Bun.randomUUIDv7()`**（Bun ネイティブ、依存ゼロ）。
- **理由（DDD）**: 集約は生成された瞬間から identity を持つべき。DB 採番だと id が
  永続化に依存し、「保存前に id を使えない / ドメインの単体テストに DB が要る /
  集約が未完成のまま生まれる」といった問題が連鎖する。
- Vaughn Vernon『実践 DDD』の序列でも **アプリ早期採番 > 永続化採番**。
- uuidv7 はアプリ生成でも **時間順序**なので、インデックス局所性の利点はそのまま得られる
  （DB 側 `uuidv7()` の売りが相殺される）。
- スキーマ上は `id` に DB DEFAULT を付けない（アプリが必ず id を渡す）。

---

## 文字数制限

- **mail_address = 255**: RFC 5321 の実質上限 254 に収まる切りのいい値。
  （内訳: ローカル部 64 + ドメイン部 255、SMTP 経路制約で全体 254）
- **name = 100**: 技術的上限はなく業務ルール。日英どちらの名前にも十分でバランスが良い。
- **hashed_password = text（上限なし）**: name / mail とは逆に、これは**サーバー生成の不透明値**
  （`Bun.password` が出力するハッシュ）で、ユーザーが長さを操作できないため暴走入力を防ぐ上限が不要。
  むしろ `varchar(n)` で縛ると、アルゴリズム/パラメータ変更でハッシュ長が伸びた時に
  **サイレント切り捨て → 認証が壊れる**危険がある（text と varchar(n) は Postgres 上で性能差なし）。
- 補足: 本来 name / mail の上限は **API 層（TypeSpec / zod）でも二重に守る**予定。DB は最後の砦。

> **原則**: ユーザー入力の列は上限で守る（`varchar`）。サーバー生成の不透明値は `text` で切り捨て事故を防ぐ。

---

## マイグレーション運用

### generate と migrate は分ける

```text
drizzle-schema.ts 編集
  → pnpm db:generate --name <name>   # TS → SQL 生成（DB 不要・差分計算）
  → 生成 SQL をレビュー
  → pnpm db:migrate                  # SQL を DB に適用（冪等）
```

- **generate**: TS スキーマと「前回スナップショット（`meta/`）」の差分を SQL に書き出す。DB 接続不要。
- **migrate**: 生成済み SQL を DB に適用。`__drizzle_migrations` テーブルで適用済みを記録し、
  未適用分だけ流す（冪等）。
- **分ける理由**:
  1. 生成 SQL を**レビュー**できる（破壊的変更・データ消失を事前に検知）。
  2. **本番では migrate しか実行しない**（generate は開発時に 1 回だけ、成果物を commit）。

### コマンド

| script                           | 内容                                                            |
| -------------------------------- | --------------------------------------------------------------- |
| `pnpm db:generate --name <name>` | マイグレーション生成（`--name` は任意。省くとランダム語になる） |
| `pnpm db:migrate`                | 適用（`bun run db/migrate.ts`）                                 |
| `pnpm db:studio`                 | GUI（`https://local.drizzle.studio`）                           |

### ファイル名はタイムスタンプ接頭辞

`drizzle.config.ts` で `migrations.prefix: "timestamp"` を指定している。

```text
20260801224553_create_t_user.sql    ← YYYYMMDDHHMMSS_<name>
```

連番（`0000_`）をやめた理由は、**ブランチを分けて作業したときに同じ番号が衝突する**から。
タイムスタンプなら衝突しない。

- 時刻は **UTC**。JST の朝に作ると前日の日付になる（07:42 JST = 前日 22:42 UTC）。
- **適用順を決めるのはファイル名ではなく `meta/_journal.json` の `idx`**。
  ファイル名は「いつ作ったか」を読むためのもの。
- `--name` は任意。付けなければ `20260801224553_black_spectrum.sql` のようなランダム語になる。
  順序はタイムスタンプが担うので、`--name` は後から読んで分かるようにするためだけの用途。

DB コンテナの起動 / 停止は `docker compose up -d` / `docker compose stop` を直接実行する（pnpm スクリプトにはしていない）。

### migrations は git 管理する

- **`drizzle-schema.ts` = 目的地、`migrations/` = そこへ至る道順**。既存データを壊さず変化させるには
  道順（順序付き SQL）が要る。schema だけでは足りない。
- `meta/`（スナップショット・目録）も **セットでコミット**（次回 generate の差分基準になるため）。
- append-only で増えていくのが正常。ただし **どの DB にも適用していない間（pre-prod）は
  リセット（`rm -rf migrations` して再生成）してよい**。一度でも適用したら追記のみ。

### ランタイムマイグレータを採用した理由

- `db/migrate.ts` が `drizzle-orm/bun-sql` の migrator で適用する。
  → 本番（ECS タスク）でも **`bun run` するだけ**で流せ、drizzle-kit も postgres.js も不要。
- `drizzle-kit migrate` は **Bun ネイティブ SQL ドライバに非対応**（`pg` / `postgres.js` を要求）。
  そのため CLI ではなくランタイムマイグレータを使う。

---

## Drizzle Studio（GUI）

- `pnpm db:studio` → ブラウザ（`https://local.drizzle.studio`）でテーブル閲覧・編集。
- **`postgres.js` を devDep で追加**している。理由: drizzle-kit（studio 含む）は Bun ドライバ
  非対応のため。**postgres.js は studio 専用**で、アプリ実行・マイグレーションは bun-sql のまま。
  - 住み分け: アプリ = bun-sql / マイグレーション = bun-sql / ローカル GUI = postgres.js（devDep）

---

## DB のエラーをどう扱うか

DB 由来の失敗は**性質の違う 2 種類**に分かれる。混ぜないことが要点。

|                         | 何が起きた                             | 扱い                             |
| ----------------------- | -------------------------------------- | -------------------------------- |
| **制約違反**（`23xxx`） | **業務ルールの違反**が DB で顕在化した | ドメインのエラーへ翻訳（409 等） |
| **それ以外**            | インフラの失敗                         | `RepositoryError`（500）         |

一意制約違反を `MailAddressAlreadyExistsError`（409）に翻訳しているのがひとつ目の例。
あれは「DB が壊れた」のではなく「同じメールアドレスの人が既に居た」であって、
**客に伝えるべき情報**。接続断と同じ袋に入れてはいけない。

### 内訳は型ではなくフィールドで持つ

インフラの失敗は最終的に全部 500 に丸まるが、**ログでは切り分けたい**
（「DB が落ちている」と「マイグレーション漏れ」が同じ行に見えるのは困る）。

そこで `RepositoryError` を分割せず、`failure` と `sqlState` を**フィールドとして持たせた**。

```ts
class RepositoryError extends Data.TaggedError("RepositoryError")<{
  readonly failure: RepositoryFailure; // unavailable / exhausted / contention / timeout / schema / data / unknown
  readonly sqlState?: string;
  readonly cause: unknown;
}> {}
```

**型で分けるのは、呼び出し側が違う扱いをするときだけ。** ここでは command も controller も
`handleErrorResponse` も全員が同じ扱い（500）をするので、型に出す理由がない。
3 つの型に割ると全 command のシグネチャが変わるが、誰も分岐しないので得るものが無い
（[`02-architecture.md`](02-architecture.md#ユースケースの入出力はそのコマンドクエリと同じファイルに置く) で
コマンドのエラー型に名前を付けなかったのと同じ判断）。

将来リトライを入れて**振る舞いが分岐したら**、そのとき型を検討する。

### 分類の仕方

`shared/infrastructure/db/error/classify-db-failure.ts` の `classifyDbFailure` が行う。判定の入り口は 2 つ。

| 例外の形        | 判定に使うもの                      | 例                                               |
| --------------- | ----------------------------------- | ------------------------------------------------ |
| SQLSTATE がある | `errno` の**クラス**（先頭 2 文字） | `42P01` → `schema`                               |
| SQLSTATE が無い | Bun 独自の `code`                   | `ERR_POSTGRES_CONNECTION_CLOSED` → `unavailable` |

**接続できないときも例外は `PostgresError` だが `errno` は入らない。**
サーバが何も返していないので当然だが、`errno` だけを見ていると
接続断が `unknown` に落ちる。実際に一度そうなった（DB を止めて確認して気付いた）。

クラスで括るのは、同じクラス内では原因の質が揃っているため（`08` はどれも「繋がらない」、
`53` はどれも「資源が足りない」）。例外は `57014`（`query_canceled`）で、
クラス `57` は「管理操作」だがこれだけは時間切れなので個別に見る。

### 検証

実 DB で確認済み。

| 起こし方            | 結果                                         |
| ------------------- | -------------------------------------------- |
| テーブル名を変える  | `failure=schema sqlState=42P01`              |
| DB コンテナを止める | `failure=unavailable`（`sqlState` は出ない） |

ログにはこう出る。`failure=schema` で検索すればマイグレーション漏れだけ拾える。

```text
level=ERROR message=リクエストの処理に失敗しました
  requestId=019fa5bc-... method=GET path=/users/... status=500
  errorTag=RepositoryError failure=schema sqlState=42P01 cause="..."
```

---

## 環境変数

- **`DATABASE_URL`** を `.env` に置く。Bun は `.env` を自動読込。drizzle.config.ts は
  `import "dotenv/config"` で読む。
- **未設定のまま進ませない。** アプリは Effect の `Config` が、道具側（`db/migrate.ts` /
  `drizzle.config.ts`）は `db/database-url.ts` が、それぞれ起動時点で落とす。
  素の `process.env.DATABASE_URL!` に戻してはいけない — **Bun.sql は未設定をエラーにせず
  既定の接続先（localhost / OS ユーザー名）へフォールバックする**ため、設定漏れが
  「動かない」ではなく「**別の DB に繋がる**」に化ける
  （[`04-backlog.md`](04-backlog.md#processenvdatabase_url-の起動時検証2026-08-08-に解決)）。
- **`.env`（実値・gitignore）と `.env.example`（雛形・commit）** に分ける。ローカルの接続情報は
  秘密ではないが、本番の秘密（RDS のパスワード等）は将来 **Secrets Manager 等から ECS タスクに注入**する。
  この「実行時は環境変数から」という作法を最初から通しておく。
