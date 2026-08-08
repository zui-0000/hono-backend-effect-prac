# hono-backend-effect-prac

Hono + CQRS + DDD を学習するためのバックエンド（Bun ランタイム）。

## セットアップ

### 事前インストール

**[mise](https://mise.jdx.dev/)** — Bun / pnpm / Node のバージョンを `mise.toml` に固定して揃える。

```zsh
brew install mise
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc   # シェル起動時に有効化
```

**[Docker](https://www.docker.com/)** — 開発用 PostgreSQL をコンテナで動かす。
Docker Desktop を入れて起動しておく（`docker compose` を使う）。

### 手順

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

### スキーマ（TypeSpec）

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

## ローカルサーバー起動

```zsh
pnpm dev
```

## Drizzle Studio 起動

```zsh
pnpm db:studio
```

## テスト

```zsh
# 単体テスト
pnpm test
```

## 静的解析・フォーマット

```zsh
# lint 自動修正 → 整形 → 型チェック → 依存検査（一括）
pnpm lint:fix
```

## ドキュメント

いずれも「**なぜその選択をしたか**」を残すことを目的にしている。

- [`docs/00-tech-stack.md`](docs/00-tech-stack.md) — 技術スタックと Effect の使い方
  （`Effect<A, E, R>` の 3 つの型引数がどう設計の制約になっているか）
- [`docs/01-database.md`](docs/01-database.md) — DB 周りの設計と運用
  （Postgres / Drizzle の選定、id 戦略、マイグレーション運用）
- [`docs/02-architecture.md`](docs/02-architecture.md) — ディレクトリ構成と命名の規約
  （ツリー、`contexts/` の理由、バレル不使用、`infrastructure/` の命名、ドメインサービス、応答の形）
- [`docs/03-boundary-enforcement.md`](docs/03-boundary-enforcement.md) — 境界の機械的な強制
  （oxlint と dependency-cruiser の役割分担、層ごとの可否表、踏んだ落とし穴）
- [`docs/04-backlog.md`](docs/04-backlog.md) — 積み残し
  （テスト着手時に固定すべき挙動、未実装のユースケース、先送りした判断とその理由）
- [`docs/05-auth/`](docs/05-auth/) — 認証（ここだけディレクトリを切っている）
  - [`00-authentication-methods.md`](docs/05-auth/00-authentication-methods.md) — **方式そのものの解説**。
    セッションと JWT、券の運び方、二段構えの理由、踏みやすい落とし穴。
    このリポジトリの決定ではなく一般的な知識なので、他の doc とは性質が違う
  - [`01-our-approach.md`](docs/05-auth/01-our-approach.md) — **このリポジトリの決定**。
    契約が既に決めていること、そこから導かれる設計、まだ決めていないことと決める引き金
