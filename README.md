# hono-backend-effect-prac

Hono + Effect + CQRS + DDD を学習するためのバックエンド（Bun ランタイム）。

## セットアップ

初回に必要なもの、手順、API 契約（TypeSpec）の生成は
[`docs/06-setup.md`](docs/06-setup.md) にまとめてある。

## 動作確認

```zsh
# 開発サーバーを起動（ホットリロード）
pnpm dev

# 単体テスト（モジュール単位）
pnpm test

# API テスト（エンドポイント単位）
pnpm test:api

# lint 修正 → 整形 → 型チェック → 依存構造検査（一括）
pnpm lint:fix

# Drizzle Studio で DB の中身を見る
pnpm db:studio
```

API を変えたときは、テストだけでなく実 DB を立てて通しでも叩く。

```zsh
docker compose up -d
pnpm db:migrate
pnpm start
```

テストの分け方と規約は [`docs/02-architecture.md`](docs/02-architecture.md#テストは-2-種類に分け対象の隣に置く) にある。

## ドキュメント

いずれも「**なぜその選択をしたか**」を残すことを目的にしている。
番号は書いた順で、読む順ではない。

- [`docs/00-tech-stack.md`](docs/00-tech-stack.md) — 技術スタックと Effect の使い方
  （`Effect<A, E, R>` の 3 つの型引数がどう設計の制約になっているか）
- [`docs/01-database.md`](docs/01-database.md) — DB 周りの設計と運用
  （Postgres / Drizzle の選定、id 戦略、マイグレーション運用）
- [`docs/02-architecture.md`](docs/02-architecture.md) — ディレクトリ構成と命名の規約
  （ツリー、`contexts/` の理由、バレル不使用、`infrastructure/` の命名、テストの規約、応答の形）
- [`docs/03-boundary-enforcement.md`](docs/03-boundary-enforcement.md) — 境界の機械的な強制
  （oxlint と dependency-cruiser の役割分担、層ごとの可否表、踏んだ落とし穴）
- [`docs/04-backlog.md`](docs/04-backlog.md) — 積み残し
  （固定すべき挙動、未実装のユースケース、先送りした判断とその理由）
- [`docs/05-auth/`](docs/05-auth/) — 認証（ここだけディレクトリを切っている）
  - [`00-authentication-methods.md`](docs/05-auth/00-authentication-methods.md) — **方式そのものの解説**。
    セッションと JWT、券の運び方、二段構えの理由、踏みやすい落とし穴。
    このリポジトリの決定ではなく一般的な知識なので、他の doc とは性質が違う
  - [`01-our-approach.md`](docs/05-auth/01-our-approach.md) — **このリポジトリの決定**。
    契約が既に決めていること、そこから導かれる設計、まだ決めていないことと決める引き金
- [`docs/06-setup.md`](docs/06-setup.md) — 環境構築
  （事前インストール、手順、TypeSpec → OpenAPI → Effect Schema の生成）
