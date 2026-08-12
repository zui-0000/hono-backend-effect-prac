# 04. 積み残し

「あとでやる」と決めたものの置き場。**なぜ後回しにしたか**と、
**着手するとき何を見ればいいか**を残す（忘れるのは判断そのものより理由のほうなので）。

---

## 次にやること

やりたい順ではなく、**着手するとき何を見ればいいか**を書く。

### 1. `handleWithEffect` と認証判定の仕組みの見直し

> ✅ **認可は 2026-08-11 に実装した。** 残っているのは `handleWithEffect` の見直しのほう。
>
> 穴の実測結果は **4 本中 3 本**で、ここに書いてあった「4 本すべて」は誤りだった。
> パスワード変更だけは通らない — `verifyUserPassword` が現在のパスワードを求めるため
> 401 になる（`change-password-command.ts` の doc が「トークンを盗まれても
> パスワードは変えられない」と予告していたとおり）。それでも認可は足した。
> 守りが照合の実装に依存していて、本人確認をメール確認等に変えた瞬間に消えるから。
>
> 入れたもの: `checkUserIsSelf`（`domain/services/`）、コマンド／クエリの入力に `actor`、
> `ForbiddenError` → **403**（404 に畳まない理由は
> [`02-architecture.md`](02-architecture.md#認可の失敗は-403404-に畳まない)）、
> `presentation-not-to-context-domain`（認可を controller に書けなくする境界ルール）。
> テストは認可 4 件 + ドメインサービス 3 件。**わざと壊して 7 件とも落ちることを確認済み。**

#### 参考にする記事

[DDD×CQRS の認可設計 — コマンドとクエリで異なる権限チェックをどこに置くか](https://zenn.dev/135yshr/articles/60d7d006c0f38f)

主張は**認可を 2 段に分ける**こと。

| 粒度   | 判断基準                | 置き場                           | うちの現状            |
| ------ | ----------------------- | -------------------------------- | --------------------- |
| 粗粒度 | ロール / エンドポイント | middleware                       | ロールが無いので空    |
| 細粒度 | リソースの所有者・状態  | application + domain（ポリシー） | **どこにも無い** ← 穴 |

`verifyBearer` が「トークンを検証して claims を出すところまで」で止まっているのは、
記事の推奨どおりの形。足りないのは細粒度のほう。

記事が挙げるアンチパターンのうち、**うちが踏みかけているのは 1 つ目**
（handler に認可を埋める）。4 本の controller に `if (auth.sub !== params.id)` を
書くのがいちばん短い直し方だが、ドメイン知識が散り、修正漏れの温床になる。
2 つ目（middleware で全面的にやる）は構造が既に防いでいる — `verifyBearer` は
`shared/` にあり、境界ルールで `contexts/` を参照できない。
4 つ目（エラーに内部情報を載せる）は `UnauthorizedError` が `message` を持たない形で
既に守れている。

#### コードの側から既に答えが出ている論点

**コマンドとクエリで、取りうる形が違う。**

```ts
// コマンド: 集約を復元するので「引いてから照合」ができる
UpdateUserCommandInput = { id, name, mailAddress }; // ← actor を足せる

// クエリ: 射影に id が無いので「引いてから照合」が原理的にできない
GetUserQueryOutput = { name, mailAddress };
```

`GetUserQueryOutput` から `id` を落としたのは
[読み取り用の射影として意図的にそぎ落とした](02-architecture.md)結果だが、
そのおかげで**クエリ側は記事の言う「可視性制御」しか選べない** —
`execute` に actor を渡してクエリ自体を絞る形になる。
副産物として「見つからない」と「権限が無い」が同じ `Option.none` に畳まれ、
**存在を漏らさない 404 が構造から落ちてくる**。

#### 決めたこと（2026-08-11 に実装済み）

1. **actor をどこまで運ぶか** → controller で `claims.sub` を入力に足し、`UserId` へ
   decode する（`logout` が `sid` → `SessionId` でやっているのと同じ形）。
2. **判定をどこに置くか** → `domain/services/check-user-is-self.ts`。記事はポリシー
   オブジェクトを推すが、規則がまだ 1 つなので
   [実例が 1 つの間は抽象化しない](#db-呼び出しのラッパをどこまで共有するか)に従った
   （`checkMailAddressDuplication` と同じ置き場・同じ粒度）。ロールが増えたらここが育つ。
3. **403 か 404 か** → **403**。一度 404 に畳む形で実装したが、認可の失敗と不在を
   混ぜないほうが規則として一貫するので戻した。契約に 403 と errorCode 4030 を足してある。

#### 認証を Hono の middleware へ降ろすか（見送り中）

「`handleWithEffect` が太い」ことへの対処として検討し、**いまは見送った**。
記事の言う middleware は**層の話**であって Hono の API の話ではなく、
`verifyBearer` は署名検証と claims 抽出しかせず、境界ルールで `contexts/` を
参照できない。**記事の推奨は既に満たしている。**

数えたところ、出ていくのは 170 行中 12 行（7%）。引き換えに払うものが 3 つある。

1. **型付き claims が消える。** いまは `auth: true` を書いた経路にだけ
   `auth: AccessTokenClaims` が現れ、書いていない controller では型に存在しない。
   middleware にすると `c.get("claims")` になり、全経路で参照可能かつ
   `undefined` かもしれない値になる。**これを諦めない限りファイルは縮まない** —
   宣言を残すなら条件型も残り、動く場所が変わるだけ。
2. **401 が相関 ID と契約の形を失う。** middleware は handler の前なので
   `resolveRequestId` も `handleFailures` も走っていない。401 の本文を
   自前で組み立て直すことになり、エラー翻訳が 2 箇所になる。
3. ~~**400 と 401 の順序が黙って逆転する。**~~ **2026-08-09 に解消。**
   「認証を通っていない相手には契約の話を一切しない」を優先し、
   `validateRequest` の中で認証を先頭へ移した。middleware に出しても
   順序は変わらなくなったので、これはもうコストではない。

**残るコストは 2 と、「1 リクエスト = 1 Effect」が壊れること。**
着手の引き金は、認証より前に走らせたい横断的な処理（レート制限など）が
出てきたとき。そのときは相関 ID とログごと middleware 層へ降ろす
**まとめての再設計**になる。中途半端にやると 2 を踏む。

> 2026-08-09 に**最外周の 1 枚だけ**を middleware にした（`resolveRequestId` /
> `handleNotFound`）。相関 ID は経路にマッチしないリクエストにも要るもので、
> **そこにしか置けない**から。認証と契約検証は経路ごとに要否が変わるので中に残した。
> 「責務で切ったとき、middleware にしか置けないものだけを外に出す」が今の線引き。
>
> 型の心配は解消した。`createMiddleware<{ Variables }>` はチェーン先まで交差型で
> 伝播するので、**middleware にしても型付き claims は失われない**（上の 1 は誤りだった）。
> 残るコストは 2 と 3、および「1 リクエスト = 1 Effect」が壊れること。

あわせて [`handleWithEffect` の型の複雑さ](#handlewitheffect-の型の複雑さ) も見る。

### 2. Effect-TS の書き方の全体見直し

一通り動くようになったので、**書き方の癖を揃える**。見る観点:

- `Effect.gen` と `pipe` の使い分け（いまは層ごとに揺れている）
- `Effect.orDie` を使ってよい境界（「DB の値は信用する」以外に広げていないか）
- `Effect.all` の `concurrency` 指定漏れ（既定は逐次）
- エラーチャネル `E` の粒度 — 型付きエラーと defect の線引き
- `Layer` の粒度と、`Context.GenericTag` / `Context.Tag` の使い分け

### 3. 単体テストの追加

現状は**単体 8 / API 37**で、単体は `classifyRefreshToken` の 1 本しかない。
筆頭は [`classifyDbFailure` の 7 分類](#まだ埋まっていない穴) — 純粋な関数なので、
偽の例外を渡すだけで全部覆える。実 DB でしか踏めない 2 つとは事情が違う。

カバレッジ閾値（`coverageThreshold`）もここで入れる。いま入れないのは、bun が
**一度も import されなかったファイルを表に載せない**ため、未テストのモジュールが
0% ではなく「存在しない」ことになり、分母が安定していないから。

### 4. lint の規約の見直し（一巡済み。着手不要）

全カテゴリを `warn` で通して測った。**カテゴリ単位で足すものは無かった。**

| カテゴリ      | 件数 | 判断                                                   |
| ------------- | ---- | ------------------------------------------------------ |
| `perf`        | 2    | `Effect.map` の誤検出 + テストの `await`               |
| `suspicious`  | 3    | **全件** `_tag`（`Data.TaggedError` の判別子）の誤検出 |
| `pedantic`    | 54   | 下記                                                   |
| `restriction` | 174  | `no-async-await` 66 件                                 |
| `style`       | 636  | `sort-keys` 141 件（`ErrorCode` の HTTP 順を壊す）     |

落とした理由は件数ではなく中身。**Effect のメソッド名が配列のそれと衝突する**ため、
この codebase でいちばん多い書き方が軒並み誤検出になる
（`Option.some` → `Array.prototype.some`、`Effect.map` → `Array.prototype.map`）。

採ったのは `require-unicode-regexp` の 1 本だけ。**測ったなかで偽陽性が
ゼロだった唯一のルール**で、6 件すべて実在・修正は `u` を 1 文字足すだけだった。
`u` の前後で値オブジェクトの通る／弾かれるが変わらないことも実測済み。

> **惜しかったもの: `unicorn/no-array-callback-reference`。**
> 実際に踏んだバグ（`arr.map(Schema.encodeSync(X))` が index を `ParseOptions` に
> 食わせる）を検出できることを確認したが、**17 件中 16 件が `Option.some` の誤検出**。
> 黙らせるには disable コメントが 16 個要るので見送った。
> **着手の引き金は oxlint がこのルールに除外設定を持つこと。**

#### `@effect/tsgo` の診断（2026-08-11 に一巡した）

同じやり方で測った。**全 79 ルールを `error` にして `tsc` を通す**
（`tsconfig.measure.json` を一時的に作り、`diagnosticSeverity` に全ルールを列挙）。
**採るものは無かった。**

`tsc` が既定で報告するのは Correctness カテゴリだけで、Anti-pattern / Effect-native /
Style の 60 本以上は**そもそも見えていない**。測らないと存在に気付けない。

| ルール                 | 本番 | テスト | 判断                                              |
| ---------------------- | ---: | -----: | ------------------------------------------------- |
| `unnecessaryPipeChain` |   32 |      0 | 既に `off`（pipe を 1 段ずつ分ける規約と衝突）    |
| `asyncFunction`        |    3 |     67 | Hono の API が `async` を要求。構造上避けられない |
| `globalDate`           |    2 |     19 | **本番 2 件とも誤検出**（下記）                   |
| `deterministicKeys`    |    2 |      0 | 実在。だが見送り（下記）                          |
| `processEnv`           |    1 |      0 | `db/database-url.ts`（drizzle 用ツール）          |
| `globalConsole`        |    1 |      0 | `db/migrate.ts`（スクリプト）                     |
| `strictEffectProvide`  |    0 |      1 | テストのみ                                        |

**`globalDate` の 2 件はどちらも `new Date(millis)`（引数付き）** で、システム時刻を
読んでいない。うち 1 件は `shared/domain/clock.ts` ——「Clock を使え」と Clock 自身に
言っている。ルールは `new Date` という形だけを見ている。

> **惜しかったもの: `deterministicKeys`。**
> サービスの識別子をパス込みの完全修飾（`hono-backend-effect-prac/contexts/user/
domain/user-repository/UserRepository`）にせよ、という主張。同名の Tag が別パッケージに
> あっても衝突しない。**指摘は実在だが、`Context.Tag`（クラス形式）の 2 件しか見ず、
> `Context.GenericTag` の 7 件は素通しする。** 同じ問題を抱えているのに片方だけ直す形になり、
> ログに出る名前も長大化する。単一アプリで衝突する相手もいない。
> `no-array-callback-reference` と同じ理由（検出範囲の偏り）で見送った。
> **着手の引き金は GenericTag も対象になること、またはパッケージを分けること。**

測定は「Effect の造詣が要る作業」ではなかった。鳴った 7 本の中身を読むだけで済み、
むしろ**この repo がどこで Effect の外に出ているか**（Hono 境界の `async` 3 件、
Clock アダプタ）が分かった。次に測るときも同じ手順でよい。

判断そのものは [`.oxlintrc.jsonc`](../.oxlintrc.jsonc) にも書いてある。
次に足すときも [わざと違反するファイルを作って確認する](03-boundary-enforcement.md#落とし穴)
—— 検出されることと、**許可すべきものが通ること**の両方を見る。

### 5. Claude が読めるコード規約の作成

`CLAUDE.md` にあるのは運用（コミット / 検証 / ドキュメント）だけで、**コードの書き方**は
`docs/02-architecture.md` に散っている。docs は人間向けに「なぜ」を長く書いてあるので、
毎回読ませるには重い。

決めるのは線引き — **機械的に従える規則**（命名、ファイル分割、import の向き、
コメントの書き方）を短い形で `CLAUDE.md` 側に置き、その理由は docs に残してリンクする。
lint で強制できるものは規約に書かず lint に寄せる、という判断も含む。

### 6. 判断を ADR の形で引けるようにする

**内容は既に ADR になっている。足りないのは形式だけ。** docs 全体を数えると、
採用した判断が 22、見送った案が 15、あとで撤回・変更した判断が 6 で、合計 43。
日付を打って覆した判断を消さずに残す運用（`2026-08-08 に撤回`、
`shared/db/ を層で切り直さないこと（2026-08-08 に撤回して実施）`）も既にできている。

困っているのは**判断単位で引けないこと**。`02-architecture.md` は 1,099 行あり、
「なぜ応答を controller で組むのか」を探すのに全体を grep することになる。

#### 進め方は C → B

|                     | やること                                         | 評価                 |
| ------------------- | ------------------------------------------------ | -------------------- |
| A. 全面移行         | 43 個を `docs/adr/NNNN-*.md` へ分解              | **採らない**（下記） |
| B. 今後だけ ADR     | 既存はそのまま、新しい判断から ADR で書く        | second               |
| **C. 索引だけ作る** | `docs/adr/README.md` に「判断 → 記述場所」の一覧 | **first**            |

**A を採らないのは、テーマ別 doc と ADR が別の問いに答えているから。**

```
「このリポジトリの認証はどう動く？」 → docs/05-auth/ を読む   ← 物語が要る
「なぜメアドを入力どおり保存する？」 → ADR-00XX を引く        ← 判断単位が要る
```

1,099 行の `02-architecture.md` は読み物として機能している。バラすと
「全体像を掴む」用途が失われる。C の索引を作れば「引けない」は解決するので、
その上で B に移れば既存を壊さずに形式を寄せられる。

#### 着手するとき決めること

**`CLAUDE.md` の規約を書き換える必要がある。** 現在はこう書いてある。

> 設計判断は該当する `docs/NN-*.md` に追記する。

ADR を入れるなら「どちらに書くか」を明示しないと、書くたびに迷う。
線引きの案は「**判断は ADR、仕組みの説明はテーマ別 doc**」で、
ADR からテーマ別 doc へリンクする向き（逆ではない）。

索引に載せる最初の候補（直近 3 日ぶん）:

- 応答の組み立てを controller に寄せる（`02-architecture.md`）
- pipe を 1 段ずつに分ける / `unnecessaryPipeChain` を切る（`02-architecture.md` + `tsconfig.json`）
- メールアドレスは入力どおり保存し、一意性だけ大小無視（`01-database.md` + `MailAddress.tsp`）
- 自コンテキストへの import は相対（`02-architecture.md`）
- hk / committed の導入（`00-tech-stack.md`）

### 8. Effect v4 への移行（`latest` になってから）

**引き金は `npm view effect dist-tags` の `latest` が 4.x になること。**
2026-08-11 時点の状況:

```
latest  3.22.1          ← いま使っているのはこちら
beta    4.0.0-beta.107
```

開発は [`Effect-TS/effect-smol`](https://github.com/Effect-TS/effect-smol) で進んでいる
（最終 push 2026-07-14 / open issues 0）。beta を追いかけない理由は、
この repo が学習用で**壊れたときに直す時間より、壊れない土台で書く時間のほうが要る**から。

#### 移行のときに使えるもの

Effect-TS の org を一巡して見つけた（2026-08-11）。**どれも v4 に紐づくので今は入れない。**

| リポジトリ                                        | 何に使うか                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| [`skills`](https://github.com/Effect-TS/skills)   | `effect-v3-to-v4` skill が移行を誘導する。`npx skills add Effect-TS/skills` |
| [`codemod`](https://github.com/Effect-TS/codemod) | API 変更の機械的な置き換え                                                  |
| `node_modules/effect/AGENTS.md`                   | **v4 のパッケージにだけ同梱される**（v3.22.1 には無い。実測済み）           |

`AGENTS.md`（6,230 バイト）は Effect の使い方ではなく**エージェントの振る舞い**を書いた
ものだった —— 「推測するな」「単一用途に抽象を作るな」「必要な箇所だけ触れ」「単純な案が
あるなら言え、必要なら押し返せ」。**この repo の方針とほぼ一致している**ので、
[5. Claude が読めるコード規約の作成](#5-claude-が読めるコード規約の作成)を書くときの
参考にもなる（v4 を待たずに GitHub 上で読める）。

#### 見送ったもの

| リポジトリ                                                          | 理由                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`eslint-plugin`](https://github.com/Effect-TS/eslint-plugin)       | この repo は oxlint。役割も `@effect/tsgo` と重なる            |
| [`docgen`](https://github.com/Effect-TS/docgen)                     | JSDoc タグから生成する道具。この repo は**タグを使わない**方針 |
| [`vscode-extension`](https://github.com/Effect-TS/vscode-extension) | LSP は `@effect/tsgo` で入っている                             |
| `slopcop`                                                           | Effect リポジトリ自身の PR 仕分けボット                        |

`effect` モノレポの 8 パッケージ（`ai` / `atom` / `effect` / `opentelemetry` /
`platform` / `sql` / `tools` / `vitest`）のうち、`platform` / `sql` / `vitest` は
**Hono / Drizzle / bun:test を選んだ結果として対象外**。残るは `@effect/opentelemetry` だけで、
これは相関 ID と構造化ログを span に変える価値があるが、
**エクスポート先（Jaeger 等）を立てないと意味がない**ので着手の引き金はそちら。

### 7. 契約を 2026 年時点の一次情報で洗い直す

きっかけは
[Web API 設計の現在地 2026](https://qiita.com/tatsuya582/items/a800739c02eadff68c70)。
『Web API: The Good Parts』(2014) の指針を RFC・IETF Datatracker・大手実装で
洗い直した調査記事で、**11 領域それぞれについて「標準があるか / デファクトは何か」**を
一次情報で示している。この repo の契約と突き合わせた結果が下記。

| 領域                 | 記事の推奨                     | この repo                     | 判定       |
| -------------------- | ------------------------------ | ----------------------------- | ---------- |
| エラー応答           | Problem Details（RFC 9457）    | 独自 `{ errorCode, message }` | **ズレ**   |
| 日時                 | RFC 3339                       | API で日時を返していない      | —          |
| HTTP 仕様            | RFC 9110 を参照                | 4xx/5xx を契約で明示          | ✅         |
| 認証                 | OAuth 2.0 + PKCE / ROPC は禁止 | 自前のトークン発行            | **要確認** |
| バージョニング       | パス `v1` または日付ヘッダ     | 無し（`/users`）              | **未決**   |
| 廃止告知             | Deprecation / Sunset ヘッダ    | 未実装                        | —          |
| **ページネーション** | **カーソル方式**               | **ページ番号方式の型が既存**  | **要判断** |
| レートリミット       | 429 + `X-RateLimit-*`          | 未実装                        | —          |
| 冪等キー             | `Idempotency-Key`              | 未実装                        | —          |
| API 記述             | OpenAPI 3.2.0                  | **3.2.0 を出力**              | ✅ 対応済  |

#### 着手するとき見るところ

**ページネーションが最優先。** `schema/src/shared/pagination/` に用意してある
`CurrentPage` / `PerPage` / `TotalPages` は**ページ番号方式**で、記事が挙げる
デファクト（GitHub / Stripe のカーソル方式）と別物。`listUsers` はまだ契約が
未定義なので、**書き始める前なら型を捨てるだけで済む**。ここは標準が無い領域なので、
記事の言う「デファクトに合わせる」を採るかどうかの判断になる。

**エラー応答は先に潰す前提がある。** Problem Details（RFC 9457、`application/problem+json`）
へ寄せるかは、[エラー応答が契約で検証されていない](#エラー応答が契約で検証されていない)を
先に解決してからでないと、形式だけ変えても穴は残る。`errorCode`（`4091` 等）の体系は
既にドメインと結びついているので、捨てる判断はそれなりに重い。

**ROPC の件は文脈を確かめてから。** 記事の「ROPC は MUST NOT（RFC 9700 / BCP 240）」は
**OAuth 2.0 の委譲フロー**——サードパーティにパスワードを渡す形——の話。
この repo の `POST /auth/login` は自分のフロントから自分のバックエンドへ送る
一次認証で、OAuth ですらない。同一視すると判断を誤る。
ただし `docs/05-auth/` に OAuth / PKCE への言及が 1 件も無いので（grep 済み）、
**「なぜ OAuth ではなく自前のトークン発行にしたか」を書き足す材料**にはなる。

~~**OpenAPI 3.2.0 はこちらから動かせない。**~~ **2026-08-12 に解決。**
「TypeSpec の出力が 3.1.0 なので上流待ち」と書いていたが、**調べずに書いた推測で誤り**だった。
`@typespec/openapi3` 1.14.0 は `openapi-versions` に `3.0.0 / 3.1.0 / 3.2.0` を取れる。
`schema/src/tspconfig.yaml` の 1 行を書き換えるだけで済んだ。

出力の差分は `openapi: 3.1.0` → `3.2.0` の **1 行のみ**で、スキーマの中身は完全に同一。
orval の生成コードも 1 バイトも変わらなかった（3.1 → 3.2 は互換性のある拡張で、
この契約が使っている機能の範囲では表現が変わらない）。

---

## テスト着手時に固定すべきこと

現在は**単体 8 / API 37**（規約は [`02-architecture.md`](02-architecture.md#テストは-2-種類に分け対象の隣に置く)）。
長らく HTTP 境界の統合テストだけで進め、**形が固まってからまとめて書く**方針を採った。
この判断は正しく機能していて、プレゼンテーション層を 13 段階作り替えても、
`Database` を Layer 化しても、`shared/db` を丸ごと移動しても、
HTTP 境界のテストは 1 行も変えずに通り続けた（安定した縫い目にだけ置いているため）。

### すでに固定されている繊細な挙動

作り替えの過程で見つかった罠は、いずれも既にテストで固定してある。
**重複して書かないこと**（どれも「壊れると気付きにくい」類なので、消さないこと）。

| 対象                          | 固定されている挙動                                 | 壊れたときに起きること                      |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------- |
| `checkMailAddressDuplication` | `excluding` が自分の id なら重複と見なさない       | 「メールアドレスを変えない更新」が常に 409  |
| `checkMailAddressDuplication` | 他人が使っていれば 409                             | 重複を素通しし、DB の unique 制約で 500     |
| `changeUserProfile`           | `updatedAt` だけ進み `createdAt` は据え置き        | 作成日時が更新のたびに書き換わる            |
| `changeUserProfile`           | 元の集約は書き換わらない（新しい値を返す）         | 呼び出し側が握っている集約に変更が波及する  |
| `handleWithEffect`            | `status: 204` は本文を持たない                     | 契約と異なる応答を返す                      |
| `handleWithEffect`            | 応答は契約スキーマどおり（余分な項目が出ない）     | 射影で落としたはずの項目が漏れる            |
| `verifyUserPassword`          | 照合に渡すのは「現在の平文」と「保存済みハッシュ」 | 新旧を取り違え、どんな平文でも通る          |
| `changePasswordCommand`       | 401 のときは永続化が走らない                       | 照合に失敗してもパスワードが変わる          |
| `changeUserPassword`          | 変わるのは hashedPassword と updatedAt だけ        | 名前・メールアドレス・作成日時が巻き戻る    |
| `handleWithEffect`            | defect でも契約どおりの 500 と相関 ID を返す       | 平文 500 が返り、ログも残らない             |
| `resolveRequestId`            | 経路にマッチしなくても相関 ID を応答に載せる       | 打ち間違いの調査で手掛かりが消える          |
| `handleNotFound`              | 未知の経路でも契約と同じ形の 404                   | 平文 404 が返り、クライアントの分岐が割れる |
| `resolveRequestId`            | 載せられない ID を採番した値で置き換える           | ログインジェクションの防御が効かない        |
| `classifyRefreshToken`        | 猶予期間の境界 30 秒ちょうどは内側                 | 並行更新したタブが盗難扱いされる            |
| `classifyRefreshToken`        | 理由が `rotated` 以外なら猶予を与えない            | 切ったセッションが 30 秒間生き返る          |
| `refreshCommand`              | 再利用のみセッションを切り、失効済みは切り直さない | 盗難検出の直後にセッションが復活する        |
| `loginCommand`                | 保存するのはハッシュだけ / `sid` はセッション      | 平文の券が DB に残る、ログアウトが効かない  |

### まだ埋まっていない穴

| 対象                                | 何が未検証か                                     | 壊れたときに起きること                    |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| `validateQuery`                     | **一度も実行されていない**                       | クエリ検証が丸ごと壊れていても気付けない  |
| `validateHeader` の失敗経路         | `X-Request-Id` の欠落・形式不正で 400 になること | 相関 ID の無いリクエストが通る            |
| `UserRepositoryLive` の `set` 句    | 各更新が「その遷移の列」だけを書くこと           | 列をまたぐロストアップデートが復活する    |
| `handleMailAddressDuplicationError` | 制約名が実物と一致すること（実測済み・未自動化） | 制約名が変わると 409 が黙って 500 になる  |
| `classifyDbFailure` の対応表        | 7 つの内訳のうち 2 つしか実測していない          | ログの内訳が嘘になる（応答は 500 のまま） |
| **認可**                            | `claims.sub` と対象 id の突き合わせが**無い**    | 他人のリソースを取得・更新・削除できる    |

`set` 句は偽のリポジトリでは覆えない（テストが見ているのはポートの呼び分けまで）。
実 DB でレースを起こして確認したが、その手順は自動化していない。
手順は [`02-architecture.md`](02-architecture.md#書き込みポートは集約ではなく状態遷移に対応させる) を参照。

`handleMailAddressDuplicationError` も同じ理由で偽のリポジトリでは覆えない（制約が存在しないため）。
さらに厄介なのは、**普段はこの経路を通らない**こと。`createUserCommand` は先に
`checkMailAddressDuplication` を通すので、通常の重複 POST が出す 409 はドメインサービス由来で、
そこまで届かない。つまりこの翻訳を丸ごと壊しても**テストは全部通り、手動の疎通確認も
409 を返す**。「消しても壊れないように見える」類なので、消さないこと
（両方が要る理由は
[`02-architecture.md`](02-architecture.md#一意性は事前チェックと-db-制約の二段構えで守る)）。

2026-08-08 に実 DB で確認した手順:

1. `docker compose up -d` → `pnpm db:migrate` → `pnpm start`
2. **同一メールアドレスで 10 リクエストを同時に** `POST /users`
3. 応答が `201` × 1 / `409` × 9 / `500` × 0 になること
4. `docker logs hono-effect-prac-db | grep "duplicate key value violates unique constraint"` が
   **9 件**で、制約名が `t_user_mail_address_unique` であること

4 が本命。ここが 0 件なら事前チェックが弾いただけで、この経路は検証できていない。
実測では 10 本すべてが事前チェックを通過し、9 件が制約で弾かれた（違反は約 29ms の間に集中）。
窓が広いのは、チェックの後に argon2id のハッシュ化（~100ms）が挟まるため。

`classifyDbFailure` は実 DB で `schema`（テーブル名を変える）と `unavailable`（DB を止める）
だけ確認した。残る `exhausted` / `contention` / `timeout` / `data` は**表を信じているだけ**。
分類は純粋な関数なので、偽の例外を渡す単体テストで全部覆える
（[`01-database.md`](01-database.md#分類の仕方) 参照）。ただし現在のテストは
HTTP 境界のみという方針なので、単体テストを足すかどうかは**テスト着手時にまとめて判断する**。

`validateQuery` はクエリパラメータを使うエンドポイントがまだ無いため（`listUsers` 未実装）、
実装時が初回実行になる。あわせて `c.req.query()` が繰り返しパラメータの
最初の 1 つしか返さない件（`validateQuery` の doc 参照）も、そのとき判断する。

`validateHeader` の失敗経路は、全テストが正しい `X-Request-Id` を送っているため
成功経路しか踏んでいない（`resolveRequestId` のテストが不正な ID を送るのは
経路にマッチしないリクエストなので、`validateHeader` までは届かない）。

### テストの限界（意図的に受け入れているもの）

API テストはステータスと errorCode を `HttpStatus` / `ErrorCode` から参照している。
可読性を優先した判断だが、**定数の値そのものが変わったケースは検出できない**
（実装とテストが同じ定数を見るため）。契約（TypeSpec）と実装のステータス一致を
機械的に照合する仕組みは今のところ無い。

---

## 実装の積み残し

> `auth` コンテキスト（`login` / `logout` / `refresh`）は実装済み。
> 予告どおり `GetUserQueryService` はログインに使えず（`id` も `hashedPassword` も
> 含まない射影のため）、user 側に `VerifyCredentialsQueryService` を用意する形になった。
> Customer/Supplier の初適用。経緯は [`05-auth/01-our-approach.md`](05-auth/01-our-approach.md)。
> **残っているのは認可**（上記「次にやること」）。

### `listUsers`（契約が未定義）

`schema/src/contexts/users/index.tsp` に `listUsers` を足すところから。
`schema/src/shared/pagination/` の型（`CurrentPage` / `PerPage` / `TotalCount` / `TotalPages`）は
このために用意してある。応答は封筒ではなく `{ items, totalCount, ... }` という
それ自体が意味を持つオブジェクトになる（[`02-architecture.md`](02-architecture.md#一覧について)）。

> ⚠️ **用意してある型はページ番号方式で、現在のデファクトはカーソル方式。**
> 着手前に下記「契約を 2026 年時点の一次情報で洗い直す」を読むこと。
> 型を捨てる判断になるかもしれない。

---

## 先送りした判断

### `process.env.DATABASE_URL!` の起動時検証（2026-08-08 に解決）

かつて 3 箇所で非 null 断言を使っていた。当時は「**型を黙らせているだけ**で、
設定漏れがあっても最初のクエリまでエラーにならない」と書いていたが、
**この見立ては実害を過小評価していた**（後述）。3 箇所とも塞ぎ、断言はゼロになった。

アプリ本体（`shared/infrastructure/db/database-client.ts`）は `Config.redacted` +
起動時のランタイム構築で解決。`DATABASE_URL` を外して確認済み — exit 1 で落ち、
ポートは開かない。**効いたのは `Config` ではなく `main.ts` の
`await runtime.runtime()` のほう**で、`ManagedRuntime` が遅延構築である以上、
読み方を変えるだけでは壊れ方が変わらなかった
（[`02-architecture.md`](02-architecture.md#ランタイムは起動時に構築しきる)）。

道具側 2 つ（ルートの `drizzle.config.ts` / `db/migrate.ts`）は
[`db/database-url.ts`](../db/database-url.ts) で塞いだ。Effect の外にいるため
`Config` は使えず、素の `process.env` を読んで未設定なら throw する。
機構がアプリ側と 2 つに分かれるが、どちらも「依存を揃えられないなら動かさない」で
揃っており、スクリプト 2 本のために Effect を持ち込むほうが不自然になる。
`drizzle.config.ts` からの相対 import が drizzle-kit のローダで解決できることは
実際に `db:generate` を通して確認した。未設定・空文字のどちらでも
**両コマンドが exit 1 で落ちる**ことも確認済み。

> **「実害は小さい」は誤りだった。** 着手前は「コマンドを手で叩くので失敗が即座に
> 人間の目に入る」と見積もっていたが、実測したところ **Bun.sql は未設定を
> エラーにせず既定の接続先へフォールバックする**。localhost:5432 に OS ユーザー名で
> 繋ぎにいき、手元では `password authentication failed for user "zui"` で止まった。
> つまり設定漏れは「動かない」ではなく「**別の DB に繋がる**」に化ける。
> ローカルに trust 認証の Postgres が居れば、意図しない DB にマイグレーションが当たる。
> 表に出るのも `Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"` で、
> 環境変数の話が一言も出てこない。
> **見積もりは「壊れ方を実際に踏んでから」書くこと。**

### エラー応答が契約で検証されていない

成功応答は `handleWithEffect` が生成スキーマで検証してから返すが、
エラー応答は `c.json(response.body, ...)` でそのまま返している。
`ErrorBody` が TypeSpec のエラーモデルとズレても検出されない。

塞ぐなら `response` にエラー時のスキーマも宣言させることになるが、
エンドポイントごとに 4〜5 個列挙する必要があり、routes が大きく膨らむ。
エラーの形は 1 箇所（`errorBody`）でしか作られず、契約側の 6 モデルも
すべて同じ形なので、**費用対効果が見合わないと判断して見送った**。

### DB 呼び出しのラッパをどこまで共有するか

DB 呼び出しを包む処理のうち、コンテキストに依存しない
[`handleDbError`](../src/shared/infrastructure/db/error/handle-db-error.ts) は共有側へ出した。
`UserRepositoryLive` と `GetUserQueryServiceLive` の両方が必要としており、
後者は同じ中身を手で書き直していたため、**既にあった重複を消す**変更でもあった。

`UserRepositoryLive` に残した `handleMailAddressDuplicationError` は出していない。制約名
（`t_user_mail_address_unique`）、翻訳先（`MailAddressDuplicationError`）、
引数（`user.mailAddress` を読むためだけの `User`）の**すべてが user 固有**だから。

一般化するなら「制約 → ドメインエラー」の対応表を渡す形になるが、
**対応表の実例が 1 つしかない状態で形を決めると、2 つ目でだいたい合わない。**

**着手の引き金は 2 つ目の実例が出ること。** 具体的には、別のコンテキストか別の制約で
「一意制約違反をドメインのエラーに翻訳したい」が現れたとき。そのとき 2 つを並べて、
共通するのが本当に対応表の形なのかを見る。

`toDomainHead`（先頭行を集約に復元し、0 件なら `Option.none`）も残しているが、
**理由は上と違う**。こちらは一般化した形が機械的に決まる
（`decodeHead(schema)`）ので、設計の余地という意味では出せる。
出していないのは**消費者が 1 人しかおらず、`handleDbError` と違って消せる重複が無い**から。
Query Service 側と重なっているのは `Option.fromNullable(rows[0])` の 1 行だけで、
そこは Effect の `Array.head` が既に持っている。

**引き金は 2 つ目のコンテキストが自前の Repository を持つこと。** そのとき寄せれば
「DB の値は信用する（`Effect.orDie`）」という方針も 1 箇所に揃う。

### 未使用のエラークラス

`ConflictError` / `InternalServerError` は一度も `new` されていない。
`ConflictError` は汎用 409 として出番がありうる。
`InternalServerError` は 500 を `RepositoryError` の翻訳経由で出しているため、
**直接 new する場面が無い可能性が高い**。

**auth を実装しても両方とも 0 件のままだった**ので、判断の時期は来ている。
削除するか、認可（403）で `ConflictError` 相当が要るかを見てから決める。

`UnauthorizedError` は `changePassword` で使い始めた。その際、`ResourceNotFoundError` に
倣って `message` フィールドを落としている（文言を決めるのは presentation の責務。
認証の失敗はどこで失敗したかを書き分けてはいけない種類のエラーでもある）。

### コンテキストを跨ぐ書き込みとトランザクション

**まだ実例が無い。** いまのユースケースはどれも 1 コンテキストで閉じているので、
形を決めずに置いてある。ただ「跨ぐ日が来たら何を変えることになるか」は調べた。

#### 「複数テーブル」は 3 つに分かれる

| 形                         | 答え                                              |
| -------------------------- | ------------------------------------------------- |
| 1 つの集約が複数テーブル   | 集約の境界内。repository が両方書くだけ           |
| 同じコンテキストの複数集約 | **ポートのメソッド 1 つ = トランザクション 1 つ** |
| コンテキストを跨ぐ         | 下記。ここだけ未解決                              |

2 つ目は既に実装例がある。`RefreshTokenRepository.rotate` が
「古い券を失効 + 新しい券を発行」を `db.transaction` で 1 単位にしている。
`revoke` と `issue` の 2 メソッドに分けなかったのは、**間で落ちると
再ログインしか道が無くなる**から。一貫性が要るなら 1 メソッドにする、が今の答え。

#### 跨ぐ場合、repository を直接触るのは違う

`cross-context-public-only` が止める（`domain/` にあっても届かない）。
**仮に止められなくても避ける**。
`UserRepository` を auth が握れば `create` も `deleteById` も握ることになり、
user 側の不変条件を auth が破れるようになる。検討順はこう:

1. **本当に跨いでいるか疑う。** 「1 トランザクションで一貫していないと困る」なら、
   それは**同じ集約であるべき**というサインかもしれない
   （DDD の「トランザクション境界 = 集約境界」）。
2. **順に command を呼ぶ。** 相手コンテキストの**ポート**越しに。
   `loginCommand` が `VerifyCredentialsQueryService` を呼ぶのと同じ形。
   ただし**トランザクションは分かれる**ので、片方だけ成功しうる。
3. **結果整合にする。** ドメインイベント + アウトボックス。コストは高い。

#### 2 を「1 トランザクションで」やる道はある。ただし 1 行変える必要がある

`Database` が**注入されるサービス**なので、ユースケースをトランザクション版の
`Database` で包めば、両コンテキストの repository が互いを知らないまま
同じトランザクションに乗る。

**ただし今のコードのままでは動かない。**

```ts
export const UserRepositoryLive = Layer.effect(UserRepository,
  Effect.gen(function* () {
    const db = yield* Database;   // ← Layer 構築時に 1 回だけ読む＝焼き付く
```

`ManagedRuntime` は起動時に Layer を構築しきる（[`02-architecture.md`](02-architecture.md#ランタイムは起動時に構築しきる)）
ので、後から `Database` を差し替えても既存の repository は古い接続を握ったまま。
動かすには **`Database` を各メソッドの中で読む**形へ移す必要がある。
1 行の位置が変わるだけだが、意味は大きい（構築時の解決 → 呼び出し時の解決）。

**着手の引き金は、跨ぐユースケースが 1 つ目に現れたとき。** 具体的には
「退会したらセッションも全部切る」のような、2 つのコンテキストの状態を
まとめて変える要求。そのとき上の 1 → 2 → 3 の順で検討する。

> **未経験の領域なので、実例が出るまで形を決めない。** リレーションのある
> テーブルの一括更新、跨ぐトランザクション、[楽観ロック](#バージョン列楽観ロック)は
> いずれもこのリポジトリでまだ扱っていない。先に形だけ決めると、
> 実例が出たときにだいたい合わない（`handleMailAddressDuplicationError` の一般化を
> 見送ったのと同じ理由）。

### バージョン列（楽観ロック）

同じ列への同時更新は**後勝ち**のまま。同時に 2 回パスワードを変えれば片方が消える。

列をまたぐロストアップデート（プロフィール更新とパスワード変更の相互巻き戻し）は
書き込みポートを状態遷移ごとに分けて解決済み
（[`02-architecture.md`](02-architecture.md#書き込みポートは集約ではなく状態遷移に対応させる)）。
残っているのは同一列の競合だけで、**実害が想像しにくいわりに代償が大きい**ため見送った。

代償の内訳:

- `t_user` に `version` を足すマイグレーション
- `User` 集約が `version` を持つ（ドメインが永続化の都合を知る）
- 契約の変更 — `changePassword` に 409 が増える（**破壊的変更**）
- クライアント側のリトライ設計

**着手の引き金は「複数の列にまたがる不変条件ができたとき」。** 例えば
「退会済みならメールアドレスを空にする」のような規則が入ると、列ごとに書き分けても
2 つの列が食い違う瞬間が生まれるため、集約単位の排他が要る。

### `handleWithEffect` の型の複雑さ

マップ型・判別可能ユニオン・型述語を組み合わせており、後から触りにくい部類のコード。
ただしこれは**絶対的に必要な複雑さではなく、呼び出し側の簡潔さと引き換えに買ったもの**。

> 2026-08-09 に **265 行 → 168 行**（コード 170 → 105 行）へ落とした。中身を削ったのではなく、
> 置き場を直しただけ。`RequestSchemas` / `ValidatedRequest` / `ControllerInput` と
> `validateRequest` は [`validate-request.ts`](../src/shared/presentation/handler/validate-request.ts) へ、
> 失敗と defect の受け皿は [`handle-failures.ts`](../src/shared/presentation/handler/handle-failures.ts) へ移した。
> 後者を `handle-error-response.ts` に置かなかったのは、ログ側が
> そちらの `ApplicationError` を参照しており**循環になる**ため。
> 残った `handleWithEffect` は組み立てだけを持つ。

重荷になった場合の逃げ道: `request` の 4 入力源を必ず全部書かせ、使わないものは
`undefined` を渡す形にすれば、キーの絞り込み（`as K : never`）が不要になる。
呼び出し側は 1 エンドポイントあたり 2 行増える。

### `shared/db/` を層で切り直さないこと（2026-08-08 に撤回して実施）

**長らく「やらない」と決めていた項目を覆した。** 経緯を残す。

かつては `shared/` が層で切れている（`domain/` / `application/` / `infrastructure/` /
`presentation/`）なかで `db/` だけがトピック切りで混じっており、それを意図的な形としていた。
中身の寿命が 3 種類（実行時のコード / 開発時の設定 / 運用時のスクリプトと成果物）に
分かれることは分かっていたが、**切ると DB の仕事で見る場所が 1 箇所から 4 箇所に増える**
ことを嫌った。とくにマイグレーションは追い詰められたときに触るもので、
そういう場面で「設定はどこ、journal はどこ」を思い出したくない、という理由だった。

見直しの引き金は「`src/` を単体でバンドルする必要が出たとき」または
「道具側が増えてアプリより目立ち始めたとき」と書いていた。**どちらも引かれていない。**
それでも実施したのは、**反対理由のほうが先に消えた**から。

1. **「見る場所が 4 箇所に増える」が成立しなくなった。** 当時の想定は
   「設定はルート直下、成果物と道具はその隣」とバラす案だった。実際に採ったのは
   **マイグレーション一式（設定・スクリプト・成果物）をまとめて残す**形で、
   増えたのは 1 → 2 箇所。しかも道具側はルート直下なので、かつての `src/shared/db/` の奥より
   むしろ見つけやすい。追い詰められたときに開く場所は 1 箇所のまま守られている。
2. **実行時のコードが塊として固まった。** `error/` をフォルダに整理した結果、
   「タグと Layer が離れてしまう」という懸念が消え、**まとめて動かせる**ようになった。
   同じ日の朝の時点では `client.ts` が単独ファイルだったため、この移動は成立しなかった。

得たもの:

- **`src/` はアプリだけ**という線が引けた（`drizzle.config.ts` はルート、
  `db/` にマイグレータと成果物）。`orval.config.ts` が既にルートにあったので、
  同種のツール設定が同じ場所に揃った。
- **`shared/` の直下が層の名前だけ**になった。トピック切りの混入がゼロ。
- **`db-only-from-infrastructure` を削除できた。** 移動先が `IMPL_LAYER` に含まれるため、
  既存の 4 ルールが同じことを覆う。消す前に domain / application / presentation の
  3 方向からわざと違反ファイルを作り、検出されることを確認した
  （[`03-boundary-enforcement.md`](03-boundary-enforcement.md#層ごとの可否)）。

`migrations/` の移動は `git mv` で履歴を保ち、移動後に実 DB で確認した。
`db:migrate` が `__drizzle_migrations` を 1 行のまま保つこと（重複適用なし）と、
`db:generate` が "No schema changes" を返すことの両方を見ている。
**後者が決定的**で、`out` のパスが違っていれば過去のマイグレーションを見つけられず、
重複した `CREATE TABLE` を生成していたはず。

> **引き金の立て方についての学び。** 引き金を「外部条件が変わったら」で書いていたが、
> 実際に効いたのは**自分たちの構造が変わって反対理由が消えたこと**だった。
> 見送る判断を記録するときは、条件だけでなく **「何が変われば反対理由が消えるか」**
> も書いておくとよい。

### `shared/` を `core/` にリネームしないこと

`shared` という名前だけは「中身が何か」ではなく「どの位置にあるか」を表しており、
`common` / `lib` / `utils` と同じくゴミ箱化しやすい名前ではある。
しかし `core` に替えても**同じ種類の名前**なので情報が増えず、
むしろ `shared/domain/` は DDD の**共有カーネル**そのものであるため、
`core` にすると「こちらが中心」と読めてしまい、
本体である `contexts/<ctx>/domain/` の位置付けと矛盾する。

ゴミ箱化を防いでいるのは名前ではなく、**中が「何であるか」で切れていること**
（共有カーネル / ポート / 実装 / HTTP 基盤 / エラーの語彙 / 永続化基盤）。
どれにも当てはまらないものは、そもそも `shared/` に置くべきではない、と判断できる。

### Drizzle 公式の Effect 統合（`drizzle-orm/effect-postgres`）

[公式ドキュメント](https://orm.drizzle.team/docs/connect-effect-postgres)にある、
`db.select()` が最初から `Effect` を返す統合。検討して**今は乗らない**と決めた。

調べた事実（2026-08-08 時点）:

|                |                                                                    |
| -------------- | ------------------------------------------------------------------ |
| 収録バージョン | **v1 系のみ**（`rc` = `1.0.0-rc.4`）。`latest` = `0.45.2` には無い |
| ドライバ       | `@effect/sql-pg` 0.53.0 → 中身は `pg`（node-postgres）             |
| 現在のドライバ | `drizzle-orm/bun-sql`（Bun ネイティブ SQL）                        |

つまり「drizzle を上げる」話ではなく、**メジャーの RC に乗り換え、同時にドライバも替える**話。

見送った理由は、いちばん調べ込んだコードを捨てることになるから。
[`classify-db-failure.ts`](../src/shared/infrastructure/db/error/classify-db-failure.ts) の分類は **Bun のエラー形状専用**で、
SQLSTATE が `errno` に入ること、`ERR_POSTGRES_*` が bun 1.3.14 のバイナリ由来であること、
の 2 つに全面的に依存している。`pg` は SQLSTATE を `code` に入れるため、
`FAILURE_BY_ERROR_CODE` は白紙になり、`findPostgresError` も
[`01-database.md`](01-database.md#分類の仕方) も書き直しになる。
`SqlError` の下に元の例外が残るかどうかも未確認で、そこから調べ直しになる。

副次的な代償として、runtime の依存が 3 つ（`drizzle-orm` / `effect` / `hono`）から
`pg` 系 + `@effect/sql` 系まで広がる。

得られるものも数えた。`Effect.tryPromise` は消えるが、`SqlError → RepositoryError` の
翻訳は結局書くので `handleDbError` 相当は残る（中身が入れ替わるだけ）。
**本命だった「`db` を Layer にする」ほうは、この統合を入れなくても達成できた**
（[`02-architecture.md`](02-architecture.md#db-接続も-layer-で注入する)）。
残る利点は「アダプタの記述がわずかに短くなる」程度。

**着手の引き金は drizzle v1 が stable になること。** そのとき、Bun ネイティブ SQL 側が
Effect に対応していないかも合わせて見る（対応していれば分類のコードを保ったまま乗れる）。

### CI

意図的に入れていない。**バックエンド設計の練習用リポジトリ**であり、
CI の構築自体は学習対象ではないため。品質ゲートは `pnpm lint:fix` を手で打つ運用。
