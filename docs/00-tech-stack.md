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
| git hook           | hk（コミット前に全検査を通す）             |
| コミットメッセージ | committed（Conventional Commits を強制）   |
| API スキーマ       | TypeSpec（OpenAPI 3.2 を生成）             |
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

## コミット前の検査（hk）

CLAUDE.md に「コミット前に `lint:fix` と `test` を通す」と書いてあったが、
**書いてあるだけでは通し忘れる**。[hk](https://hk.jdx.dev/)（mise と同じ jdx 製）で
git hook にした。定義は [`hk.pkl`](../hk.pkl)。

```text
git commit      pre-commit  静的検査（lint / 整形 / 型 / 依存構造）1.6 秒
                commit-msg  メッセージが Conventional Commits か
                HK=0 で 1 回だけ飛ばせる
hk check --all  静的検査を手動で。コミットせずに確認したいとき
```

**`--all` を忘れないこと。** 付けないとステージ済みのファイルしか見ず、
何もステージしていなければ `no steps to run` で**何も走らずに緑**になる。

**扱うのは静的検査だけ。** テストは `pnpm test` / `pnpm test:api` のまま残した。
コミットのたびに待たされると `HK=0` が常態化する。**止まらない門番は門番ではない**ので、
通り続けられる重さに保つ。テストは伸び続ける種類のもので、単体テストが 8 件の
現時点で 0.4 秒でも、数百件になれば話が変わる。

**`hk` に fix は持たせない。** 直すのは `pnpm lint:fix` の役目で、入口を 2 つにすると
片方だけ直して気付かない形になる。`hk check --all` と `pnpm lint:fix` が
「見るだけ / 直す」の対になる。

**ステップを並列に走らせるのが hk を使う理由。** package.json に
`pnpm check:lint && pnpm format:check && ...` と並べる案も測ったが、直列で 3.6 秒
（並列は 2.1 秒）。速さもだが、`&&` は最初に落ちたところで止まるため
**型エラーが同時にあっても見えない**。並列なら 1 回で全部出る。

設定で決めたこと:

- **各ステップは `pnpm ...` を呼ぶだけ。** ツールを直に叩くと同じコマンドが
  2 箇所に散り、片方だけ直して気付かない形になる
- **`glob` で絞らない。** 絞ると「新しい置き場を足したのに検査されない」が
  緑のまま起きる。全部で 2.4 秒なので、忘れたとき「余計に走る」方向へ倒す
  （テストの実行コマンドを除外形にしたのと同じ判断）
- **`pre-commit` と `check` は同じ steps を見る。** 手元で `hk check --all` が
  通ればコミットも通る、という関係を保つため。違うのは対象だけで、
  `pre-commit` は `stash = "git"` で**ステージされた状態だけ**を検査する
  （「手元では通るが、コミットされる状態では壊れている」を防ぐ）
- **ステップは並列に走る**（既定 `jobs: 10`）。直列なら 6.0 秒かかるものが 2.0 秒。
  1 つでも落ちればコミットは中断する（`fail_fast`）

踏んだ落とし穴が 2 つある。

**`hk install` には `--mise` が要る。** 付けないと hook が `hk` を素の PATH で探し、
mise を activate していないシェル（git hook / CI / エディタの統合ターミナル）で
`hk: command not found` になる。実際に踏んだ。`--mise` を付けると
`mise x -- hk ...` の形で入るので PATH に依存しない。
同じ理由で `package.json` 側も `mise exec -- hk ...` と書いてある
（pnpm はスクリプトを `sh` で動かすため `.zshrc` の activate が効かない）。

**`hk check` は既定でステージ済みのファイルしか見ない。** 何もステージしていない
状態で叩くと `no steps to run` で**何も走らずに緑**になる。手動確認では `--all` が要る。
pre-commit 側はステージ済みだけで正しいので、そちらは付けない。

> Git 2.54 以上なら `.git/hooks/` を触らず git config（`hook.<name>.command`）に入る。
> 他の hook マネージャと共存でき、リポジトリの中も汚れない。

### コミットメッセージ（committed）

規約は [CLAUDE.md](../CLAUDE.md) に文章で書いてあったが、こちらも**読むだけでは守れない**。
[committed](https://github.com/crate-ci/committed) を `commit-msg` フックに載せた。
設定は [`committed.toml`](../committed.toml)。

```text
feat: メッセージ一覧APIを追加        ✔
feat(auth): scope 付き               ✔
feat(api)!: 破壊的変更               ✔  CLAUDE.md の `!` マーカーも通る
メッセージ一覧APIを追加              ✗  type が無い
foo: 何か                            ✗  許可されていない type（一覧を出してくれる）
WIP: 途中 / fixup! …                 ✗
feat: 何かを追加.                    ✗  末尾の句読点
```

**日本語向けに 4 つ切ってある。** `subject_length` / `line_length` /
`hard_line_length` は CJK の文字幅で長さ判定が揺れるため 0（無制限）に、
`subject_capitalized` と `imperative_subject` は英語の大文字・命令形が前提なので false。

> **既知の穴: 全角の句点は検出されない。** `feat: 何かを追加。` は素通りする
> （`subject_not_punctuated` が見るのは ASCII の `.` `!` `?` などだけ）。実測で確認済み。

`hk` と同じく mise で入れているので、`mise install` すれば揃う。

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
  （詳細は [`★ドメインサービス/`](★ドメインサービス/#命名-check対象duplication)）。
- **`R`（依存）** — I/O を伴うことが型に出る。ドメインサービスがリポジトリのポートを
  読んでも、それが `R` に現れるので「純粋であれ」の戒律を名前や置き場所で守る必要がない。
- **`A`（成功）** — 封筒を外して素の値を返せるのは、応答の形を型が保証しているから。

副産物として、`respondedAt` を廃したときに `errorBody` から時刻取得が消え、
連鎖して `handleErrorResponse` が `Effect` を返す必要すらなくなった
（[`02-architecture.md`](02-architecture.md#api-応答を封筒envelopeで包まない)）。

---

## Effect から降りるとしたらどこへ（2026-08-14 測定）

Effect は**このリポジトリでは正解だが、仕事で人が回るチームでも正解とは限らない**。
「初見の人間には重いのでは」という疑いは正当なので、降り先を実際に測って整理しておく。
判断そのものは変えていない（Effect のまま）。ここに残すのは**引き金**と**写像**。

### まず前提 — 構造は Effect の資産ではない

`contexts/` の縦切り、`public/` の allowlist、CQRS の非対称、`query-not-to-write-model`、
`docs/` の判断記録。**どれも Effect に依存していない。**
[`.dependency-cruiser.mjs`](../.dependency-cruiser.mjs) は 1 行も変えずに
別ライブラリのコードを守る。乗り換えで書き換わるのは配線だけ。

だからこの章は「積み上げが無駄になるか」の話ではなく、**配線をどれに替えるか**の話。

### 監査 — 今このリポジトリで Effect は何を稼いでいるか

| 機能                          | 現状                                              | 他で代替できるか       |
| ----------------------------- | ------------------------------------------------- | ---------------------- |
| `E`（型付き失敗）             | フル活用。doc 規約が `@throws` を捨てた根拠       | できる                 |
| `Schema`（双方向 + branded）  | 値オブジェクト全部                                | ほぼできる（zod）      |
| **`R`（型付き DI）**          | `UserRuntime` / `Layer` / 合成ルート / 境界ルール | **これだけができない** |
| `orDie`（defect と failure）  | `verify-credentials-query-service-live.ts` の要   | 部分的（throw に戻る） |
| 構造化並行性 / `Scope` / 中断 | **ほぼ使っていない**                              | —                      |
| リトライ / Schedule / 計装    | **使っていない**                                  | —                      |

**独占的に稼いでいるのは `R` チャネル 1 本。** 並行性まわりは 1 円も回収していない。
そしてその `R` も、部分適用で依存を先に食わせる手書き DI で代替できる
（`createGetUserQuery(deps)` の形）。TypeScript はもともと引数で足りる言語で、
`Context.Tag` のファイルが要らなくなるぶん境界ルールはむしろ書きやすくなる。

### 候補の実測

週間ダウンロードと GitHub の保守シグナル。**測定日 2026-08-14。**

|                   |      weekly DL | 最新    |  stars | open issues | 最終 push      |
| ----------------- | -------------: | ------- | -----: | ----------: | -------------- |
| zod               |    254,388,559 | 4.4.3   |      — |           — | —              |
| hono              |     56,851,709 | 4.13.2  |      — |           — | —              |
| **effect**        | **26,680,112** | 3.22.1  | 15,265 |         227 | **2026-08-13** |
| ts-pattern        |      7,379,819 | 5.9.0   |      — |           — | —              |
| **better-result** |  **5,248,654** | 3.0.1   |  1,880 |           2 | 2026-08-11     |
| fp-ts             |      4,357,926 | 2.16.11 |      — |           — | —              |
| **neverthrow**    |  **2,551,436** | 8.2.0   |  7,671 |          82 | **2026-02-14** |

月間の推移（1 年）。

```text
effect         2025-08   10,249,693  →  2026-07  102,278,661   (10 倍)
neverthrow     2025-08    2,742,084  →  2026-07    9,388,920   (3.4 倍)
better-result  2026-01       34,335  →  2026-07   19,874,394   (初版が 2026-01-09)
```

読み取れること。

- **Effect は 1 年で 10 倍。** fp-ts（4.4M）の 6 倍あり、TS の関数型スロットは決着済み。
  「尖った実験」ではなくなっている。
- **普及度で neverthrow を選ぶ理屈は立たない。** Effect の 1/10 で、
  しかも **6 か月コミットが無い**（open issues 82）。Result 型は機能追加が要らないので
  「完成して落ち着いている」とも読めるが、少なくとも「動いているから安心」ではない。
- ダウンロード数は「何チームが選んだか」ではなく「何回 `node_modules` に落ちたか」。
  CI と推移的依存が混ざるため、**採用判断の根拠としては弱い**。

### better-result — Effect から `R` だけを抜いたもの

7 か月で 2000 万 DL/月まで伸びた新顔（0 依存 / MIT / ESM / 約 269KB）。
書き味が**そのまま Effect**なのが特徴。

```ts
const checkout = (cartId: string) =>
  Result.gen(function* () {
    const cart = yield* findCart(cartId);
    const reservation = yield* reserveStock(cart.items);
    return Result.ok(receipt);
  });

class InvalidPort extends TaggedError("InvalidPort")<{ input: string }> {}
```

`Result.gen` = `Effect.gen`、`TaggedError` = `Data.TaggedError`、非同期は `Result.await`。
そして **DI / Context は無い**（README に記載なし）。上の監査表でいう
「独占的に稼いでいる `R` 1 本」だけが落ちる構成で、移行差分は neverthrow より桁違いに小さい。

**ただし仕事で使う前提なら勧めない。**

- **7 か月で 3 メジャー**（`1.0.0` → `2.0.0` は 6 日）。API が固まっていない
- **バス係数 1。** コントリビュータ 14 人だが 76 commit vs 他は最大 3
- 歴史が 7 か月しかなく、社内で説明する材料が少ない

#### 誰が作っているか

主著者の dmmulroy は **Dillon Mulroy、Cloudflare のソフトウェアエンジニア**
（GitHub の `company` / `bio` に明記、フォロワー 2,200）。X でも活発に発信していて、
**界隈での注目度は高い**（実装者の観測。数値では測っていない）。

**ただし Cloudflare 公式のプロジェクトではない。** ここは分けて読むこと。

```text
cloudflare/better-result      → HTTP 404
dmmulroy/better-result owner  → type: User / organization: None
```

他のコントリビュータ 6 人の所属も見たが、**Cloudflare の人間は他に 1 人もいない**
（Medfin / Crunchyroll / AirHelp / 無所属）。

これで**懸念の性質は変わるが、大きさは変わらない**。「素性の知れない作者」ではなく
「実力ある個人の、会社の後ろ盾が無い副業プロジェクト」。前者よりはよいが、
在籍は継続性を何も保証しない。むしろ大企業の忙しいエンジニアの個人プロジェクトには
**本業が忙しくなった瞬間に優先度が落ちる**という固有の壊れ方がある。

> **裏が取れなかったこと。** 0 → 2000 万 DL/月を 7 か月という曲線が
> 人力採用によるものか、推移的依存によるものかは**特定できていない**。
> npm の `depends:` 検索は全文検索に落ちて 17 万件返すため使えなかった。
> ここを断定材料に使わないこと。
>
> **潰した仮説（次に調べる人が同じ道を通らないように）。**
> 「Cloudflare 製パッケージが引っ張っているのでは」を検証したが**外れ**。
> `wrangler` 4.123.0 / `miniflare` / `create-cloudflare` /
> `@cloudflare/vitest-pool-workers` / `@cloudflare/containers` /
> `@cloudflare/workers-shared` のいずれも依存していない（2026-08-14 時点）。
>
> **むしろ謎は深まっている。** star あたりの月間 DL を出すとこうなる。
>
> ```text
> neverthrow      stars  7,671   月間DL   9,388,920   DL/star   1,223
> effect          stars 15,265   月間DL 102,278,661   DL/star   6,700
> better-result   stars  1,880   月間DL  19,874,394   DL/star  10,571
> ```
>
> effect が高いのは `@effect/*` 一族が引っ張るためで説明がつく。
> **better-result はその effect より高い。** 発信力のある個人が出した
> 7 か月のライブラリが人力採用だけで届く比率ではなく、何かが引っ張っているが、
> その正体は不明のまま。

### スキーマはどうなるか

better-result に**自前のスキーマは無い**。代わりに
[Standard Schema](https://standardschema.dev/) の interface を同梱していて、
zod / valibot / arktype / Effect Schema を**どれでも差せる**（型定義に
`Source: https://standardschema.dev/schema#the-interface` の注記つきで入っている）。

**これはマイナスではない。** Result 型ライブラリがバリデータまで抱えるのは責務過剰で、
zod と正面からぶつかって勝てるものでもない。npm の作法でいう「自分で抱えず外に任せる」側。
Standard Schema という共通規格が成立して初めて取れる選択で、fp-ts の時代には無かった手。

ただし**スキーマを受ける口は狭い**。`Result` が公開しているスキーマ関連の API は
`Result.codec({ serialize: { ok, err }, deserialize: { ok, err } })` **だけ**で、
これは Result を境界の向こうへ送る / 受けるためのコーデック。
「入力を検証して Result にする」汎用コンビネータは無い（メソッド一覧で確認済み）。

このリポジトリで Effect Schema が担っている 4 つは、そのまま移行時の作業項目になる。

| 用途           | 現状                                                         | 移行後                                          |
| -------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| 値オブジェクト | `Schema.brand`（`UserId` / `MailAddress` / `Password` ほか） | zod の `.brand()`                               |
| 集約           | `Schema.Struct`                                              | zod のオブジェクトスキーマ                      |
| 境界の検証     | `decodeInput` / `Schema.decodeUnknown`                       | **自分で書く**（`safeParse` → `Result`、10 行） |
| 契約の生成     | orval `client: "effect"` + `useBrandedTypes`                 | orval `client: "zod"`                           |

移行の逃げ道が 2 つあることは実物で確認した。

- **orval は zod 生成器を同梱している。** `@orval/zod` を型定義が import している
  （orval 8.24.0）。生成器の差し替えで済む。
  ただし **`useBrandedTypes` に相当するオプションが zod 側にあるかは未確認**。
  移行するなら最初に潰す点。
- **Effect Schema 自身が Standard Schema を出せる。**
  `Schema.standardSchemaV1()`（effect 3.22.1 の `Schema.d.ts:124` に実在）。
  段階移行の途中で両方を同じ口として扱える。

### 混ぜてはいけない 2 つの心配ごと

「Effect は重い」には**別々の問題が 2 つ**入っている。分けないと選べない。

| 心配ごと                 | 犯人                                    | better-result | neverthrow |
| ------------------------ | --------------------------------------- | ------------- | ---------- |
| **初見の人間が読めない** | `function*` / `yield*` の do 記法       | 残る          | **消える** |
| **概念の総量が多すぎる** | `Layer` / `Context` / `Scope` / Runtime | **消える**    | 消える     |

読みやすさが問題なら答えは neverthrow の `.andThen()` チェーン。
学習範囲が問題なら better-result の方が書き味を保ったまま削れる。**逆を選ぶと解決しない。**

### 結論と、判断が逆転する引き金

| 基準                     | 1 位              | 2 位           | 3 位          |
| ------------------------ | ----------------- | -------------- | ------------- |
| 初見の読みやすさ         | neverthrow        | better-result  | effect        |
| 概念の少なさ             | neverthrow        | better-result  | effect        |
| 保守の勢い               | effect            | better-result  | neverthrow    |
| 採用の説明しやすさ       | effect            | neverthrow     | better-result |
| **今のコードからの距離** | **better-result** | effect（据置） | neverthrow    |

**このリポジトリは Effect を続ける。** 学習が目的なので、習得コストは費用ではなく成果物。

**作り直すなら zod + better-result + 手動 DI。**（2026-08-14 時点の落とし所）

理由は「Effect が難しいから」ではなく、**このアプリが Effect の高い方の機能を
使っていないから**。上の監査表がその根拠で、稼いでいるのは `R` 1 本、
並行性まわりは 1 円も回収していない。その `R` は部分適用の手動 DI
（`createGetUserQuery(deps)`）で足り、`Context.Tag` のファイルが消えるぶん
境界ルールはむしろ書きやすくなる。

当初は neverthrow を置いていたが、測って動かした。

|                  | 決め手                                                                            |
| ---------------- | --------------------------------------------------------------------------------- |
| **保守の勢い**   | neverthrow は **6 か月コミットが無い**（open issues 82）。better-result は 3 日前 |
| **移行距離**     | `Result.gen` / `TaggedError` がそのまま。書き換えるのは配線だけで済む             |
| **書き味の連続** | 今のコードの読み方を捨てずに済む。学んだ do 記法が無駄にならない                  |

**残しているリスクは実績だけ。** 7 か月・バス係数 1・3 メジャー。
**ここは承知のうえで目をつぶっている**ので、他人のプロダクトに入れるときは
判断し直すこと（この節の better-result の項に懸念をそのまま残してある）。
「読みやすさ」が最優先の現場なら、ジェネレータの出ない neverthrow が今も正解。

判断が逆転する引き金は 2 つ。

1. **並行制御・リソース管理・リトライを本気で要求する**ようになったとき
   （ワーカー、ストリーム処理、大量の外部 API を束ねる、部分失敗の扱い）。
   監査表の下 2 行が埋まった瞬間、Effect の回収額が跳ね上がり評価は逆転する。
2. **better-result の後ろ盾が個人でなくなったとき。** いま欠けているのは
   設計ではなく実績だけなので、そこが埋まれば有力になる。具体的にはこのどれか。
   - メジャーを 1 年打たない（API が固まった証拠）
   - 複数メンテナ体制になる（バス係数 1 の解消）
   - **Cloudflare が自社 SDK に取り込む**（会社としての継続コミット。
     現時点では取り込んでいないことを確認済み — 上の「潰した仮説」を参照）

### 測り直し方

数字は古くなる。同じ形で取り直せるようにしておく。

```bash
# 週間ダウンロードと最新版
for p in effect zod neverthrow better-result fp-ts; do
  curl -s "https://api.npmjs.org/downloads/point/last-week/$p"
  curl -s "https://registry.npmjs.org/$p/latest"
done

# 保守シグナル（stars / open issues / 最終 push）
curl -s "https://api.github.com/repos/Effect-TS/effect"
```
