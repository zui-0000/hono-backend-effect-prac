/**
 * 依存関係の構造ルール (dependency-cruiser)。
 *
 * oxlint の no-restricted-imports は import 文の「文字列」を見るだけなので、
 * 相対パスと別名の書き分けを取りこぼしうる。こちらは tsconfig の paths を解決して
 * 実ファイル同士の依存として判定するため、書き方に依らず必ず捕まえられる。
 *
 * さらに oxlint では表現できない「コンテキスト跨ぎ」を、from の丸括弧を
 * to 側で $1 として参照する後方参照で 1 ルールとして書ける。
 * コンテキストが増えても組み合わせ (n^2) の宣言が要らないのが利点。
 *
 * comment は違反時にそのまま端末へ出るメッセージ。規約を知らない人がその場で直せるよう
 * 「何が起きたか / なぜ禁止か / どう直すか」の 3 点を必ず書く。
 * 行頭の字下げはレポーター側で揃えられるため、ソースでは付けない。
 * 表示には err-long レポーターが必要 (既定の err は comment を出さない)。
 * package.json の check:deps で --output-type err-long を指定している。
 */

/**
 * 実装 (アダプタ) の置き場。contexts と shared を同じ扱いにする。
 *
 * 横断サービス (採番・ハッシュ化) も、ポートは shared/domain に、
 * 実装は shared/infrastructure に分けて置く。同じファイルに同居させると
 * ポートを import しただけで実装の依存まで引きずり込むうえ、
 * ここのルールはモジュール単位で判定するため検出もできない。
 */
const IMPL_LAYER = "^src/(contexts/[^/]+|shared)/infrastructure/";

/**
 * 実装を知ってはいけない側。
 * contexts の内側 3 層に加え、shared のうちポート・型・共通部品・HTTP 基盤を
 * 置く層も含む (shared は infrastructure 以外すべて)。
 * 実装を結線してよいのは合成ルート (src/app-runtime.ts) と各 *-layer.ts だけ。
 */
const PORT_SIDE =
  "^src/(contexts/[^/]+/(domain|application|presentation)" +
  "|shared/(domain|application|errors|presentation))/";

/** 違反メッセージを 3 部構成に揃えるためのヘルパー。 */
const message = ({ violation, reason, fix }) =>
  [`【違反】${violation}`, `【理由】${reason}`, `【対処】${fix}`].join("\n");

export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: message({
        violation: "モジュールが循環参照になっています。",
        reason:
          "循環は「本来 1 つであるべき責務が 2 ファイルに分かれている」か\n" +
          "「依存の向きが逆のものが混ざっている」サインです。\n" +
          "初期化順に依存する壊れ方をするため、実行時まで問題が表面化しません。",
        fix:
          "共通して必要な部分を第 3 のモジュールへ切り出し、双方がそれを参照する形にします。\n" +
          "あるいは、どちらが内側かを決めて依存を一方向に倒します。",
      }),
      from: {},
      to: { circular: true },
    },

    // ---- 層の向き (常に内向き) ----
    {
      name: "domain-not-to-outer",
      severity: "error",
      comment: message({
        violation:
          "domain 層が application / infrastructure / presentation を参照しています。",
        reason:
          "ドメインは HTTP もユースケースも DB も知らずに成立すべき層です。\n" +
          "外側を知ると、ドメインだけを取り出して読む・テストすることができなくなり、\n" +
          "「業務ルールがどこに書いてあるか」が追えなくなります。",
        fix:
          "必要なのが値なら引数で受け取ります (呼び出し側が用意する)。\n" +
          "必要なのが副作用なら domain/ にポート (Context.Tag) を定義し、\n" +
          "実装は infrastructure/ に置いて Layer で注入します。",
      }),
      from: { path: "^src/(contexts/[^/]+|shared)/domain/" },
      to: {
        path:
          "^src/(contexts/[^/]+/(application|infrastructure|presentation)" +
          "|shared/(application|infrastructure|presentation))/",
      },
    },
    {
      name: "application-not-to-impl",
      severity: "error",
      comment: message({
        violation:
          "application 層が infrastructure / presentation を参照しています。",
        reason:
          "application は「何を、どの順でやるか」だけを決める層で、実装の詳細は持ちません。\n" +
          "実装を直接掴むとテストで差し替えられなくなり、\n" +
          "DB やフレームワークを替えただけでユースケースが壊れます。",
        fix:
          "ポート (domain/ の Repository や application/ の QueryService) 越しに使います。\n" +
          "どの実装を使うかを決めるのは合成ルート (src/app-runtime.ts) だけです。",
      }),
      from: { path: "^src/(contexts/[^/]+|shared)/application/" },
      to: {
        path:
          "^src/(contexts/[^/]+/(infrastructure|presentation)" +
          "|shared/(infrastructure|presentation))/",
      },
    },
    {
      name: "presentation-not-to-context-domain",
      severity: "error",
      comment: message({
        violation: "presentation 層が contexts/<ctx>/domain を参照しています。",
        reason:
          "presentation の仕事は「入力を DTO に組み立てて application へ渡す」ことだけです。\n" +
          "ドメインに手が届くと、認可やリポジトリ呼び出しを controller / routes に\n" +
          "書けてしまいます。認可は業務ルールなのでユースケースとドメインの側にあるべきで、\n" +
          "経路ごとに散ると修正漏れの温床になります (`docs/02-architecture.md` の認可の節)。",
        fix:
          "値オブジェクトが要るなら application の入力スキーマ (XxxCommandInput /\n" +
          "XxxQueryInput) を decodeInput に通します。判定が要るなら\n" +
          "application の関数を 1 本呼び、その中でドメインサービスを使います。",
      }),
      from: {
        path: "^src/(contexts/[^/]+|shared)/presentation/",
      },
      to: { path: "^src/contexts/[^/]+/domain/" },
    },
    {
      name: "presentation-not-to-impl",
      severity: "error",
      comment: message({
        violation: "presentation 層が infrastructure を参照しています。",
        reason:
          "controller の仕事は HTTP とユースケースの橋渡しだけです。\n" +
          "実装を直接掴むと application 層を素通りでき、\n" +
          "「どの実装を使うか」の決定が合成ルート以外にも散らばります。",
        fix:
          "application の command / query を呼びます。\n" +
          "必要な依存は handleWithEffect が受け取るランタイム経由で解決され、\n" +
          "実装の結線は src/app-runtime.ts が行います。",
      }),
      from: { path: "^src/(contexts/[^/]+|shared)/presentation/" },
      to: { path: IMPL_LAYER },
    },
    {
      name: "no-indirect-path-to-impl",
      severity: "error",
      comment: message({
        violation:
          "ポート側の層から、何かを経由して infrastructure に到達しています。",
        reason:
          "直接 import していなくても、経路が繋がっていれば実装に依存していることに変わりません。\n" +
          "とくに Layer を束ねたファイル (合成ルートや *-layer.ts) を型のためだけに import すると、\n" +
          "そこから全アダプタへ経路が通ってしまいます。\n" +
          "直接依存だけを見るルールはこれを検出できないため、到達可能性で塞いでいます。",
        fix:
          "型が欲しいだけならポート (Context.Tag) を直接 import します。\n" +
          "例: ルーティングが要求するサービスの型は、Layer から導出せず\n" +
          "ポートを列挙して組み立てます (contexts/user/presentation/user-routes.ts の UserRuntime)。",
      }),
      from: { path: PORT_SIDE },
      to: { path: IMPL_LAYER, reachable: true },
    },
    // かつてここに db-only-from-infrastructure を置いていた (from: PORT_SIDE →
    // to: ^src/shared/db/)。Drizzle まわりを shared/infrastructure/db/ へ移したことで
    // IMPL_LAYER に含まれるようになり、上の 4 ルール (とくに到達可能性で見る
    // no-indirect-path-to-impl) が同じことを覆うため削除した。
    // 消す前に、わざと違反するファイルで「今も検出されること」を確認済み。
    {
      name: "handler-internals-are-private",
      severity: "error",
      comment: message({
        violation:
          "shared/presentation/handler/ を、shared/presentation の外から参照しています。",
        reason:
          "あそこは handleWithEffect が組み立てる部品置き場で、外に見せる面ではありません。\n" +
          "直接掴まれると、パイプラインの段を並べ替えるだけで利用側が壊れます。\n" +
          "実際 controller が validate* を直接呼ぶと、同じ検証が二度走ります。",
        fix:
          "shared/presentation 直下の公開面を使います。\n" +
          "  routes     → handle-with-effect.ts\n" +
          "  controller → decode-input.ts\n" +
          "  app.ts     → resolve-request-id.ts / handle-not-found.ts\n" +
          "必要なものが無ければ、直下に窓口を足してから使います。",
      }),
      from: { pathNot: "^src/shared/presentation/" },
      to: { path: "^src/shared/presentation/handler/" },
    },
    {
      name: "generated-only-from-presentation",
      severity: "error",
      comment: message({
        violation:
          "presentation 以外の層が src/generated (API 契約の生成コード) を参照しています。",
        reason:
          "生成コードは API 契約の写しであって、ドメインの語彙ではありません。\n" +
          "内側に漏らすと契約を変えるたびにドメインまで書き換えが波及し、\n" +
          "「契約の都合」と「業務の都合」が混ざります。",
        fix:
          "presentation で契約スキーマを検証し (validateJson / validateParams)、\n" +
          "decodeInput でドメインの型 (値オブジェクト) に変換してから内側へ渡します。",
      }),
      from: { pathNot: "^(src/contexts/[^/]+/presentation/|src/generated/)" },
      to: { path: "^src/generated/" },
    },

    // ---- CQRS の非対称 ----
    {
      name: "query-not-to-write-model",
      severity: "error",
      comment: message({
        violation:
          "クエリ側 (*-query.ts / *-query-service.ts) が書き込みモデル\n" +
          "(集約 または Repository ポート) を参照しています。",
        reason:
          "読み取りは集約を復元しません。読み取りに不変条件の強制は要らないからで、\n" +
          "そのぶん必要な列だけを引いて射影 (DTO) をそのまま返せます。\n" +
          "集約を掴むと、その利点を捨てたうえ「読むために書き込みモデルが要る」形になり、\n" +
          "集約の項目が変わるたびに読み取り経路まで壊れます。\n" +
          "Repository を掴むのはさらに悪く、create / deleteById まで握るため\n" +
          "クエリと名乗るモジュールから書き込みができてしまいます。",
        fix:
          "必要な項目だけを持つ射影の型を query-service 側に定義し、\n" +
          "SELECT でその形を直接作ります (contexts/user/application/get-user-query-service.ts の\n" +
          "GetUserQueryOutput と、その実装 infrastructure/get-user-query-service-live.ts)。\n" +
          "値オブジェクト (domain/model/value-objects/) とドメインサービス\n" +
          "(domain/services/) は許可しています。前者は語彙、後者は認可などの判定で、\n" +
          "どちらも集約の復元にはあたりません。",
      }),
      from: {
        path: "^src/contexts/[^/]+/(application|public)/.*-query(-service)?\\.ts$",
      },
      to: {
        path: [
          // 集約本体 (domain/model/ 直下)。value-objects/ は 1 階層下なので当たらない。
          "^src/contexts/[^/]+/domain/model/[^/]+\\.ts$",
          // 書き込みポート。
          "^src/contexts/[^/]+/domain/[^/]+-repository\\.ts$",
        ],
      },
    },

    // ---- 共有基盤の向き ----
    {
      name: "shared-not-to-contexts",
      severity: "error",
      comment: message({
        violation:
          "shared (共有基盤) が contexts を参照しています。依存が逆向きです。",
        reason:
          "共有基盤が個別コンテキストを知ると、コンテキストを 1 つ増やすたびに\n" +
          "shared を書き換えることになり、共有基盤が全体の変更点になります。",
        fix:
          "向きを逆にします (contexts が shared を使う)。\n" +
          "実装同士の結線が必要な場合に限り、合成ルート (src/app-runtime.ts) に書きます。\n" +
          "contexts を import してよいのはこのファイルだけです。",
      }),
      from: { path: "^src/shared/" },
      to: { path: "^src/contexts/" },
    },

    // ---- コンテキストの境界 (oxlint では表現できない後方参照) ----
    {
      name: "cross-context-public-only",
      severity: "error",
      comment: message({
        violation: "他コンテキストの非公開な部分を直接参照しています。",
        reason:
          "コンテキストの外から使われる前提があるのは、公開面 (public/) と\n" +
          "値オブジェクト (domain/model/value-objects/) だけです。\n" +
          "それ以外は相手の内部で、参照すると 2 つの壊れ方をします。\n" +
          "  リポジトリ → create / deleteById まで一緒に握ることになり、\n" +
          "               相手の command を通さない書き込みができてしまう\n" +
          "  集約       → 相手の業務ルールが変わるたびにこちらが壊れる\n" +
          "               (集約は書き込みモデルで、変わる理由が自分の側にない)",
        fix:
          "相手コンテキストの public/ にあるポートを参照します。\n" +
          "必要なポートが無ければ相手側に用意してもらいます\n" +
          "(DDD の Customer/Supplier: 使う側の要求を供給側が受けて公開する)。\n" +
          "識別子だけが要るなら値オブジェクトを参照します (集約は ID で参照する)。",
      }),
      from: { path: "^src/contexts/([^/]+)/" },
      to: {
        path: "^src/contexts/[^/]+/",
        pathNot: [
          // 自分のコンテキストの中は自由。
          "^src/contexts/$1/",
          // 公開面。ここに置いたものだけが「外から使ってよい」と宣言されている。
          "^src/contexts/[^/]+/public/",
          // 公表された言語 (Published Language)。値オブジェクトは振る舞いも
          // ライフサイクルも持たないので、渡しても書き込み権限が付いてこない。
          // auth の RefreshToken が userId: UserId を持つのがこの経路。
          "^src/contexts/[^/]+/domain/model/value-objects/",
        ],
      },
    },
  ],

  options: {
    // パーサーに swc を使う。dependency-cruiser 18.1.0 の tsc パーサーは
    // typescript@>=2 <7 しかサポートしておらず、本プロジェクトの TypeScript 7 では
    // 1 ファイルも解析できない (0 modules cruised になる)。
    // swc は TS の構文解析を自前で行うため TS のバージョンに縛られない。
    // import type も (tsPreCompilationDeps を付けなくても) 依存として拾う。
    parser: "swc",

    // tsconfig の paths (~/* → ./src/*) を解決させる。
    // これが無いと "~/shared/..." が未解決のままになり、ルールが素通りする。
    tsConfig: { fileName: "tsconfig.json" },

    doNotFollow: { path: "node_modules" },

    // テストファイルは境界検査の対象にしない。
    //
    // ここのルールが守っているのは**本番コードの構造**で、テストは元からその外側にいる。
    // とくに API テストは createApp を組み立てるため、合成ルート (main.ts /
    // app-runtime.ts) と同じく全アダプタへ経路が繋がる。
    // 実際 presentation/__tests__/ に置いた瞬間 no-indirect-path-to-impl が発火した
    // (あのディレクトリは PORT_SIDE に含まれるため)。
    //
    // 逆に言えば、**テストを層の内側へコロケーションする以上この除外は必須**。
    // src/__tests__/ に置いていた頃は src 直下 = PORT_SIDE の外だったので問題にならず、
    // 移した初日に露見した。
    //
    // 除外しすぎていないこと (本番コードでは今もルールが効くこと) は、
    // わざと違反するファイルを作って確認している。
    exclude: { path: "(__tests__|__mocks__)/" },

    // 実行のたびに "missing-typescript-transpiler" が警告として出るが、
    // これは承知のうえで受け入れている。TypeScript 7 が dependency-cruiser の
    // 対応範囲 (>=2 <7) の外にあることを知らせているだけで、解析は swc が完遂しており
    // 実害はない (終了コードも 0)。dependency-cruiser が TS 7 に対応すれば消える。
    //
    // 消す手段は検討済み:
    //   - stdout に出るため 2>/dev/null では消えない
    //   - tsConfig を外すと ~/* が未解決になりルールが素通りするので外せない
    //   - enhancedResolveOptions は additionalProperties: false で、
    //     tsConfig の代わりに別名解決を渡す口が無い
    //   - pnpm の packageExtensions で dependency-cruiser にだけ typescript@6 を
    //     持たせると消えるが、node_modules が 24MB 増えるため見送った
  },
};
