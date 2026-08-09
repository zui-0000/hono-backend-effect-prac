# 00. 技術スタック

| 領域               | 採用                                       |
| ------------------ | ------------------------------------------ |
| ランタイム         | Bun                                        |
| Web フレームワーク | Hono                                       |
| 関数型基盤         | Effect（Effect-TS）                        |
| パッケージ管理     | pnpm                                       |
| ツールチェーン管理 | mise（Bun / pnpm / Node のバージョン固定） |
| DB                 | PostgreSQL 18（Docker）                    |
| ORM                | Drizzle（`bun-sql` ドライバ）              |
| Lint / Format      | oxlint / oxfmt                             |
| Effect の静的検査  | @effect/tsgo（Effect 固有の診断）          |
| API スキーマ       | TypeSpec（OpenAPI 3.1 を生成）             |
| バリデーション     | Effect Schema（orval で OpenAPI から生成） |
| 言語               | TypeScript                                 |

PostgreSQL のバージョン選定と Drizzle / `bun-sql` を選んだ理由は
[`01-database.md`](01-database.md) にある。

---

## 更新確認が「何も無い」と言うとき

`pnpm check:updates` が沈黙しても、**更新が無いとは限らない**。

pnpm は v11 から [`minimumReleaseAge`](https://pnpm.io/settings/dependency-resolution)
の既定値が **1440 分（24 時間）** で、公開から 24 時間経っていないバージョンを
無視する。侵害されたパッケージを掴まないためのサプライチェーン対策で、
悪意ある公開の多くは 1 時間以内にレジストリから消えることを前提にしている。

つまり `pnpm outdated` の沈黙は「更新が無い」ではなく
**「いま入れられるものは無い」**という意味。実際にこれで一度混乱したので、
2 本に分けてある。

| コマンド                     | 見えるもの                                          |
| ---------------------------- | --------------------------------------------------- |
| `pnpm check:updates`         | いま入れられる更新（pnpm が実際に入れるものと一致） |
| `pnpm check:updates:pending` | 検疫中（24 時間以内の公開）を含む、存在する全部     |

`npm outdated` や `npx npm-check-updates` は検疫を知らないため、
`check:updates:pending` と同じものを出す。**それらが出す版に
`package.json` を書き換えても、24 時間経つまで `pnpm install` は入れない**
（急ぐ場合は `minimumReleaseAgeExclude` で個別に除外する）。

`minimumReleaseAge` を 0 にする案は採らない。最新に追従したい動機と、
公開直後の攻撃を最速で踏む危険は裏表なので、既定の 24 時間はそのまま活かす。

なお `--recursive` は付けない。ワークスペースではないため効果が無く、
`-r` は既定でワークスペースルートを除外するので誤解のもとになる。

---

## Effect 固有の診断（@effect/tsgo）

tsc も oxlint も**Effect の意味を知らない**。`yield*` を忘れた Effect も、
`Layer.mergeAll` の中で依存が満たされない Layer も、型としては正しいので通る。
そこだけを見るのが [`@effect/tsgo`](https://github.com/Effect-TS/tsgo)。
**`tsc` そのものに混ぜてある**ので、`pnpm check:types` が Effect 診断も出す。

```text
error TS377001: This Effect value is neither yielded nor used in an assignment. effect(floatingEffect)
```

`@effect/tsgo` は TypeScript-Go の上位集合で、**入っている TypeScript と同じ版の
`tsc` バイナリを同梱している**（7.0.2 用が入る）。`prepare` の
`effect-tsgo patch --typescript` がそれを差し込む。

動かし方は 3 つあり（`tsc` に混ぜる / 専用コマンド / oxlint patch）、**1 つ目を選んだ**。
専用コマンドは型チェックがもう一度走るため、実測で `lint:fix` が 1.7 秒延びた。
混ぜれば `check:types` は 1.06 秒のままで、増分はゼロ。

診断は warning でも `tsc` の終了コードを 1 にする（実測で確認）。
止まらないと CI を素通りするので、ここは既定のままでよい。

> **この方式の弱点は「効いていなくても静か」なこと。** patch が当たっていなければ
> `tsc` は普通に成功する。保険は 2 つ置いてある。
> `prepare` が失敗すれば install ごと落ちること（同梱版が無ければ patch はエラーになる）と、
> patch と無関係に走る `pnpm check:effect` が残してあること。
> 疑わしいときは後者で確かめる。

導入時に 103 ファイルから 1 件見つかった。`app-runtime.ts` が
`PasswordHasherLive` を `mergeAll` と `provide` の両方に書いて辻褄を合わせていた箇所で、
`Layer.provideMerge` に直すと重複ごと消えた（`AppServices` が変わらないことは
型で、通しで動くことは実 DB で確認済み）。

選定の経緯:

| 候補                       | 判断                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `@effect/eslint-plugin`    | 却下。最終更新 2025-04 で、ESLint 本体が要る（oxlint と二重） |
| `@effect/language-service` | 却下。README が「TS 7 以降は @effect/tsgo を使え」と明記      |
| `@effect/tsgo`             | **採用。** TS 7 対応で、CLI が CI に載る                      |

**プラグイン名がパッケージ名と違う**（`tsconfig.json` に書くのは
`@effect/language-service`）。ここは間違えやすい。

代償は容量で、Go 版 tsgo のバイナリを同梱するため **node_modules が約 140MB 増える**。
実行時間は 103 ファイルで約 1.7 秒（`tsc` の 1.1 秒とは別に走る）。

## Effect（Effect-TS）

ドメインからプレゼンテーションまで [Effect](https://effect.website/) を全面採用し、
関数型で実装している。

- **値オブジェクト / モデル** — `Schema.brand` で名目型として表現し、集約は `Schema.Struct` +
  純粋関数（イミュータブル）で構成する。
- **エラー** — `Data.TaggedError` による型付きエラー。`throw` は使わず、失敗はすべて
  `Effect<A, E, R>` の `E` に現れる。
- **依存注入** — `Context.Tag` でポートを定義し、実装は `Layer` として注入する
  （時刻は `Clock`、採番・ハッシュ化は自前のサービス）。副作用はサービス経由に隔離しており、
  テストでは実装を差し替えて決定的に検証できる。
- **境界** — API 契約（OpenAPI）から生成した Effect Schema でリクエスト / レスポンスを検証する。
  ドメインと同じスキーマ体系のため、検証結果がそのまま Effect のエラーチャネルに乗る。

### 型に出ることの効き方

`Effect<A, E, R>` の 3 つの型引数がそのまま設計の制約になっている。

- **`E`（失敗）** — 何で失敗しうるかが呼び出し側に見える。だから
  「一意性の検証は `check<対象>Duplication`」のように、**名前で失敗を説明しなくてよい**
  （詳細は [`02-architecture.md`](02-architecture.md#命名-check対象duplication)）。
- **`R`（依存）** — I/O を伴うことが型に出る。ドメインサービスがリポジトリのポートを
  読んでも、それが `R` に現れるので「純粋であれ」の戒律を名前や置き場所で守る必要がない。
- **`A`（成功）** — 封筒を外して素の値を返せるのは、応答の形を型が保証しているから。

副産物として、`respondedAt` を廃したときに `errorBody` から時刻取得が消え、
連鎖して `handleErrorResponse` が `Effect` を返す必要すらなくなった
（[`02-architecture.md`](02-architecture.md#api-応答を封筒envelopeで包まない)）。
