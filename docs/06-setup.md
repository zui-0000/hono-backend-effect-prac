# 06. 環境構築

初回に必要なものと、その手順。API 契約（TypeSpec）の生成もここに置く。

日々の確認コマンド（`dev` / `test` / `lint:fix` など）は
[README](../README.md#動作確認) にある。

> 番号は**書いた順**であって読む順ではない。実際にはこの doc がいちばん最初に要る。

---

## 事前インストール

**[mise](https://mise.jdx.dev/)** — Bun / pnpm / Node のバージョンを `mise.toml` に固定して揃える。

```zsh
brew install mise
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc   # シェル起動時に有効化
```

**[Docker](https://www.docker.com/)** — 開発用 PostgreSQL をコンテナで動かす。
Docker Desktop を入れて起動しておく（`docker compose` を使う）。

---

## 手順

```zsh
# 1. Bun / pnpm / Node を mise.toml のバージョンで導入
mise install

# 2. 依存をインストール
pnpm install

# 3. API 契約側の依存もインストール（schema/ は pnpm のインストール単位が独立している）
cd schema && pnpm install && cd ..

# 4. 環境変数を用意（ローカル DB 接続情報）
cp .env.example .env

# 5. 開発用 PostgreSQL を起動（停止は docker compose stop）
docker compose up -d

# 6. マイグレーションを生成（スキーマ変更時のみ。初回 clone は既存 migration があるので省略可）
pnpm db:generate --name <name>   # --name は任意（省くとランダム語になる）

# 7. マイグレーションを適用（t_user 等を作成）
pnpm db:migrate
```

`pnpm install` で `prepare` が走り、2 つのことが起きる。

1. `src/generated/` が作られる（生成物は git 管理外なので、**clone 直後は必須**）
2. `tsc` に Effect 診断が差し込まれる（`effect-tsgo patch --typescript`）
3. git hook が入る（`hk install --mise`）

2 のおかげで `pnpm check:types` が Effect 固有の問題も見る
（[`00-tech-stack.md`](00-tech-stack.md#effect-固有の診断effecttsgo)）。
3 で `git commit` のたびに検査が走るようになる
（[`00-tech-stack.md`](00-tech-stack.md#コミット前の検査hk)）。

いずれも **git 管理外のもの**（`node_modules` と `.git/`）を触るので、
clone や `node_modules` の作り直しのたびに必要になる。だから `prepare` に置いてある。

> **hk の hook には Git 2.54 以上が要る。** それ未満だと `.git/hooks/` に
> スクリプトが書かれる形にフォールバックする（動作は同じ）。

DB コンテナの起動 / 停止を pnpm スクリプトにしていない理由や、
マイグレーションの運用は [`01-database.md`](01-database.md) にある。

### `.env` は tooling も読む

`DATABASE_URL` はアプリだけでなく `drizzle.config.ts`（`db:generate` / `db:studio`）も使う。
未設定でも `Bun.sql` は localhost と OS ユーザー名にフォールバックするため、
**エラーにならず「別の DB に繋がる」**。手順 4 を飛ばさないこと。

---

## スキーマ（TypeSpec）

API 契約は `schema/` に TypeSpec で定義する。

ディレクトリの切り方は `src/` と揃えてある（`schema/src/contexts/<context>/` と
`schema/src/shared/`）。契約とコードで同じ語彙・同じ区切りを使うことで、
「この endpoint はどのコンテキストの持ち物か」が両側で一致する。

以下は **`cd schema` してから実行する**。

| script         | 内容                                               |
| -------------- | -------------------------------------------------- |
| `pnpm build`   | `.tsp` → OpenAPI（`dist/openapi.yaml`）を生成      |
| `pnpm format`  | `.tsp` を整形                                      |
| `pnpm preview` | Redoc で閲覧（`http://localhost:8080`, 要 Docker） |

スキーマを変更したら、Effect Schema まで反映する:

```zsh
cd schema
pnpm build          # .tsp → OpenAPI（dist/openapi.yaml）
cd ..
pnpm generate:api   # OpenAPI → Effect Schema（src/generated）
```

生成された `src/generated/` を参照してよいのは presentation 層だけで、
これは lint で強制している（[`03-boundary-enforcement.md`](03-boundary-enforcement.md)）。
例外はテストで、リクエストのボディを契約の型で縛るために参照する
（[`02-architecture.md`](02-architecture.md)）。
