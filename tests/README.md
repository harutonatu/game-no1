# ゆびあそび 統合テスト（tests/）

ゲーム集「ゆびあそび」（メニュー・ブロックパズル・ばいばいタイル・キリトリ道場・いろコード・ゼンマイさんぽ・ピカッと早押し・ハシわたり・いろびん・まとめてポン・ミチビキ空港・もくもくこうば・ちきゅうを守れ！ほしくだき の12本）を、本物のブラウザで動かして確かめるテストです。
アプリのファイル（index.html・games/・common/・sw.js・manifest.webmanifest・icons/）には触れず、読むだけです。
設計・項目の対応表は [design.md](design.md) にあります。

## 実行方法

リポジトリのルートで：

```sh
node tests/run.mjs smoke      # 毎回の小さな修正で（目標 15 秒以内）
node tests/run.mjs full       # 公開前に（目標 60 秒以内）
```

- 必要なもの：Node.js（18 以上）と Playwright。`import('playwright')` で読めればそれを、読めなければ `npm root -g` の下（グローバル）の `playwright/index.mjs` を使います。**package.json や node_modules はリポジトリに入れません。**
- 配信元は既定でリポジトリのルート（tests/ の 1 つ上）。別のフォルダを試すときは `node tests/run.mjs smoke <フォルダ>`（または環境変数 `GAME_ROOT`）。
- サーバーは Node 標準だけで、GitHub Pages と同じ `/game-no1/` のサブパスで配信します。テストの中で起動し、終わったら必ず止めます。
- 終了コード：全項目合格（既知の不具合を除く）なら 0、不合格があれば 1。

### 環境変数

| 変数 | 既定 | 意味 |
|---|---|---|
| `BROWSER` | `chromium` | `chromium` か `webkit`（Safari と同じエンジン）。WebKit は `node "$(npm root -g)/playwright/cli.js" install webkit` で入れる（足りないライブラリは `install-deps webkit`） |
| `WORKERS` | `3` | グループ単位で並列に流す数。`1` で順番に（v38 で 4→3。クラウドの 4 コアで公開の条件を確かめる数） |
| `PORT` | `8800` | サーバーのポート。並列の i 番目は `PORT+i` を使う（既定なら 8800〜8802） |
| `PORT`（同時に流すとき） | — | 別々のテストを同時に流すとき（例：2 人の担当が同じ作業フォルダで）は、`PORT` を WORKERS ぶん以上離す（例 9100・9200・9300）。6 コアでは Chromium 2 本＋WebKit 1 本程度まで（T-04） |
| `ONLY` | — | 項目を絞る（例 `ONLY=D2,S1`） |
| `VERBOSE` | — | `1` で合格した確認も表示 |
| `JSON` | — | 結果を JSON に書き出すパス |
| `CLOCK` | — | `0` で待ち時間の早送りを止め、すべて実時間で待つ（早送りのせいで合否が変わっていないかの確認用） |
| `TEST_TIMEOUT` | `60000` | 1 項目の上限（ms）。止まっても全体は止まらない。項目ごとに `timeout:`（ms）で長くできる（既定より長いときだけ使う。FW19 は WebKit で 50〜56 秒かかるので 120000。T-24） |
| `HEADED` | — | `1` で画面を出してブラウザを起動する（既定はヘッドレス）。下の「画面を出して流す」 |

**速さを測る項目は最後に 1 つずつ**：速さを測る項目（A5・WW10・KW10・FW18・HW19、`solo: true`）は、WORKERS が 2 以上のとき、ほかのグループが全部終わってから 1 つずつ流れる（出力に「（速さ・1 つずつ）」と出る）。並列の負荷で速さの測定が落ちないため（T-02・T-09）。WORKERS=1 なら今までどおり。

**ページ・ブラウザが落ちたときだけ 1 回流し直す**：項目がページ・ブラウザが落ちた例外（`Target crashed` など。WebKit で起きる。MT-14）で止まったときだけ、run.mjs がその項目を 1 回だけ流し直す（「↻ 流し直し 1 回」と出て、最後に「流し直し 1 回（ページ・ブラウザが落ちた）: …」の行が出る）。1 回目の結果は捨て、2 回目を合否にする。**ページが止まった（応答しない）ときも、同じように 1 回だけ流し直す**（v39、T-27・WW12・WW25・QW3。ユーザー決定「入れる (Recommended)」。run.mjs の `STALLED`）：1 項目の時間切れ（`… 秒以内に終わらない`）・Playwright の操作の時間切れで呼び出しの記録が `locator resolved to <…>` で終わっているもの（押せるかの確かめ `attempting`・`retrying` に入る前に止まった＝ページが応答しない。`resolved to hidden / visible` や `N ×` で終わるのは、押せない・隠れている＝ふつうの不合格で、流し直さない）・CDP のタッチが 10 秒返らない。止まった回は、その回の check を記録せず（裏で動き続けた項目の確かめが次の項目に混ざらないように）、その項目のページを閉じる。ページが落ちた（Target crashed）ときは、ブラウザごと起動し直してから流し直す。最後の行は「流し直し（ページ・ブラウザが落ちた・止まった）: WW5（2 回。3 回目は合格）」の形。check の失敗・ほかの例外は流し直さない。関門の報告には、この「流し直し」の行をそのまま書く。
**v40 の変更**：(1) 落ちたとき・止まったときの流し直しは、どちらも **1 回のまま**（ユーザー決定 2026-10-25「1回のまま」。調査の途中で「落ちたときは 2 回まで」にしたが戻した）。落ちる原因は次のとおり：WebKit（Linux・画面なし）は canvas から canvas へ `drawImage` するページ（もくもくこうば・まとめてポン）で、ブラウザの中の確かめ（dmesg に `WPEWebProcess … trap invalid opcode … libWPEWebKit`）で落ち、WW5 は単独で 20 回中 6〜7 回落ち、うち 2〜4 回は起動し直した 2 回目も落ちた（master でも同じ。画面を出す `HEADED=1` では 20 回中 0 回）。(2) 押せた（`click action done`）のに、そのあとのページの移動が終わらない（呼び出しの記録が `waiting for scheduled navigations to finish` で終わる）時間切れも「止まった」に入れる（v40 の関門の I8）。(3) 例外の詳しい文は Playwright の呼び出しの記録を全部残す（前は 4 行で切れて、止まった場所が分からなかった）。

### 画面を出して流す（HEADED=1）

**公開の条件の WebKit は、画面ありで流します**（v40。ユーザー決定 2026-10-25「画面ありに変える」。課題 MT-14）。画面なし（ヘッドレス）の WebKit は、描く仕組み（WPEWebProcess）の不具合で、canvas から canvas への `drawImage` のときブラウザが「Target crashed」で落ちるためです。Chromium はこれまでどおりヘッドレスでよい。開始時の表示行に「画面: あり」と出ます。

```sh
# クラウド（Linux、画面が無い）：xvfb-run -a で仮の画面を用意する。これが公開の条件の WebKit のコマンド
HEADED=1 BROWSER=webkit WORKERS=1 xvfb-run -a node tests/run.mjs smoke
```

```powershell
# Windows PowerShell（画面があるので xvfb-run は不要）
$env:HEADED=1; $env:BROWSER="webkit"; $env:WORKERS=1; node tests/run.mjs smoke
```

- Linux で画面（`DISPLAY`）が無いのに `HEADED=1` にすると、「xvfb-run -a をつけてください」と出て止まります。
- PowerShell の `$env:` は、そのウィンドウを閉じるまで残ります。ヘッドレスに戻すときは `Remove-Item Env:HEADED`。
- **会社の PC には監視ソフトがあり、ヘッドレスのブラウザが止められる可能性があります。テスト（Playwright）を使ってよいか、会社の決まりを確かめてから使ってください。**

### いろコード（I グループ）の見方

- **I1〜I3・I9 は Node だけ**（ブラウザ不要）。`games/irocode/logic.js` を `require` し、score は 1296×1296 通りを別実装と照合、保存データの検証は壊れた値 55 種で確かめる。画面ができる前でも流せる。
- **I4〜I8 は smoke**（基本操作・保存・メニューへ戻れる・画面内・オフライン）、**I10〜I19 は full**（境界値・色覚・効果音・ダブルタップ抑止・日付の変わり目・最大値・保存不可・画面サイズ・日付の仕様）。
- 画面の確認は担当間で決めた DOM（`a#back`、`#palette button[data-color]`、`#submit`、`#rows .row[data-hit][data-blow]`、`#overlay .card`、`[data-cmd=again|menu|restart|confirm|cancel]`、`window.IroCodeGame.getState()` など）だけに頼る。問題の答えは `getState().secret` から読み、途中経過は logic.js の `newGame`・`score` で作って `irocode.state` に注入する。
- 初めて開くと「遊び方」カードが出る。画面のテストは開いた直後にそのカードの `[data-cmd=close]` を押して閉じてから操作する（`open()`・`closeHelp()`）。ふつうは入力中の同じ色を押せないので、外れの推測（`wrong()`）は4色ともちがう並びにする。
- 「今日の1問」の日付の確認（I14・I19）は、時計を 23:59:50 などに合わせ、タイムゾーンを日本とロサンゼルスの2通りで流す（上の「日付・時計」）。日付の仕様（0時をまたいで遊び続ける・確認／遊び方カード中にまたぐ・端末の時計が戻る・途中で捨てたときの成績）は I19。

### 結果の読み方

```
■ D データ保護・互換  (7.9s)
  PASS  D1    2.0s  2048 の途中経過が再読み込みで消えない …  (3/3)
        △ 既知の不具合（修正待ち・合否に含めない）: …    ← KNOWN_ISSUES に登録済み
        ★ 既知の不具合が解消した: …                      ← 直った。lib.mjs の KNOWN_ISSUES から外す
  対象外 T1  …（webkit では不可：CDP のタッチ操作）        ← そのブラウザでは流せない項目
結果 [full / chromium]：テスト 51/51 合格、確認項目 …（ほかに既知の不具合 4 件）、所要 … 秒
```

## smoke と full の使い分け

| 変更 | 流すもの |
|---|---|
| どんな変更でも（コミット前） | `node tests/run.mjs smoke` |
| CSS・HTML の配置・文字の大きさ | smoke ＋ `ONLY=V1,V2,V3,V4,V5,V6,V7,V12,V13,E4,E5 node tests/run.mjs full`（ブロックのスコア欄の 5 桁は V12。変異は `ONLY=V12,X1 M=M27`） |
| sw.js・manifest・ファイルの追加や改名（CACHE_VERSION を上げたとき） | smoke ＋ `ONLY=L5,L10,L11,S8,S1,S2,S3,S4,S5,S6,S7 node tests/run.mjs full`（共通のファイル `common/notice.js` を足す・開き直しの知らせ X-24 を変えたら L11 も） |
| 保存データ（localStorage）・2048 のロジック | smoke ＋ `ONLY=D1,D2,D3,D4,D5,D6,D7,D8,D9,D10,P10 node tests/run.mjs full`（古いページから書き戻さない P10 は X-20。変異は `ONLY=P10 M=M24,M25,M26`） |
| メニュー（index.html）の並び・カード・head（description・OGP。L12 は smoke に入っている） | smoke ＋ `ONLY=E1,E7,E8,D9,A4,A5,T3,V13 node tests/run.mjs full`（メニューのベストの長い記録は V13。MT-02）（並びの保存を変えたら `ONLY=E1,E7,E8,X1 M=MR1,MR2,MR3,MR4,MR5,MR6 node tests/mutants/mutate.mjs both`。MR5・MR6 は修飾キーつきのクリック（X-23）） |
| キリトリ道場（games/kiritori/） | smoke ＋ `ONLY=L7,L8,L9,D3,D10,E4,E6,V1,V2,V3,V4,V5,P8,P9,A4,A6,T5,T6 node tests/run.mjs full` |
| 効果音（common/sfx.js）・♪ボタン | smoke ＋ `ONLY=A1,A2,A3,A4,A5,A6,A7,A8,T1,T4,T6,P5 node tests/run.mjs full` |
| タッチ操作・ダブルタップ抑止 | smoke ＋ `ONLY=T1,T2,T3,T4,T5,T6,P7,E5 node tests/run.mjs full`（WebKit でも `BROWSER=webkit … smoke`） |
| いろコード（games/irocode/）の変更 | smoke ＋ `ONLY=I10,I11,I12,I13,I14,I15,I16,I17,I18,I20 node tests/run.mjs full`（ロジックだけなら `ONLY=I1,I2,I3 node tests/run.mjs smoke`、0 秒） |
| ゼンマイさんぽ（games/zenmai/）の変更 | smoke ＋ `ONLY=ZL1,ZL2,ZL3,ZL4,ZL5,ZL6,ZL7,ZU6,ZU7,ZU8,ZU9,ZU10,ZU11,ZU12,ZU13,ZU14,ZU16,ZU17 node tests/run.mjs full`（ステージの数値は ZL、画面は ZU） |
| ピカッと早押し（games/pikatto/）の変更 | smoke ＋ `ONLY=PK5,PK6,PK7,PK8,PK9,PK12,PK14,PK16,PK17,PK18,PK19,PK20,PK21,PK22 node tests/run.mjs full`（ルール・保存を変えたら `ONLY=PK1,PK3,PK9,PK15,PK16 M=MP1,MP2,MP3,MP4,MP5,MP6,MP7 node tests/mutants/mutate.mjs both`。「メニューへ」の確認（PK-33）を変えたら `ONLY=PK4,PK20,X1 M=MP11,MP12 node tests/mutants/mutate.mjs both`） |
| ハシわたり（games/hashi/）の変更 | smoke ＋ `ONLY=HW5,HW6,HW7,HW8,HW9,HW10,HW11,HW12,HW13,HW14,HW15,HW17,HW19,HW20,HW21,HW22,HW23 node tests/run.mjs full`（ロジックだけなら `ONLY=HL1,HL2,HL3,HL4,HL5,HL6,HL7,HL8,HL9,HL10,HL11,HL12,HL13 node tests/run.mjs smoke`、0 秒。ルール・保存を変えたら `PORT=9900 ONLY=HL1,…,HL13,HW1,…,HW19,HW23 M=MH1,…,MH20,MH29,MH30,MH31,MH32 node tests/mutants/mutate.mjs both`（10 個ずつに分けて流す）。古いページから書き戻さない（X-20）を変えたら `ONLY=HW20 M=MH21,MH22,MH23 PORT=9900 node tests/mutants/mutate.mjs both`。v31 の直しを変えたら `ONLY=HW21 M=MH24,MH25,MH26,MH27 node tests/mutants/mutate.mjs both`。HW22 を変えたら ONLY=HW22,X1 M=MH33） |
| いろびん（games/irobin/）の変更 | smoke ＋ `ONLY=BW5,BW6,BW7,BW8,BW9,BW10,BW11,BW12,BW13,BW14,BW15,BW16,BW20,BW21,BW22,BW23,BW24,BW25,BW26,BW27,BW28,BW29,BW30,BW33,BW34,BW35,BW36,BW37,BW38,BW39 node tests/run.mjs full`（BW31・BW32 は smoke に入っている。ロジックだけなら `ONLY=BL1,BL2,BL3,BL4,BL5,BL6,BL7,BL8,BL9,BL10,BL11,BL12,BL13,BL14,BL15,BL16,BL17,BL18,BL19,BL21,BL22,BL23,BL24,BL25,BL26,BL27 node tests/run.mjs smoke`、約 9 秒。ルール・保存・生成を変えたら `ONLY=BL1,…,BL19,BL21,BL22,BL23,BL24,BL25,BL26,BL27,BW1,…,BW18,BW22,BW23,BW24,BW25,BW26,BW27,BW29,BW30,BW31,BW32,BW33,BW36,BW37,BW39 M=MB1,…,MB17,MB19,MB20,MB21,MB26,MB27,MB28,MB29,MB30,MB31,MB32,MB33,MB34,MB35,MB36,MB37,MB38,MB39,MB40,MB41,MB42,MB43,MB44,MB45,MB46,MB47,MB48,MB49,MB50,MB51,MB52,MB53,MB54,MB55,MB56,MB57,MB58,MB59,MB60,MB61,MB62,MB63,MB64,MB65 node tests/mutants/mutate.mjs both`。MB18 は欠番。古いページから書き戻さない（X-20）を変えたら `ONLY=BW20 M=MB23,MB24,MB25 PORT=9900 node tests/mutants/mutate.mjs both`） |
| まとめてポン（games/matomete/）の変更 | smoke ＋ `ONLY=QW4,QW5,QW6,QW7,QW8,QW9,QW10,QW11,QW12,QW13,QW14,QW15,QW18,QW19,QW21,QW22,QW23 node tests/run.mjs full`（ロジックだけなら `ONLY=QL1,QL2,QL3,QL4,QL5,QL6,QL7,QL8,QL9,QL10,QL11 node tests/run.mjs full`、数秒。ルール・保存・2回タップを変えたら `ONLY=QL1,…,QL11,QW1,…,QW19 M=MQ1,MQ2,…,MQ40 node tests/mutants/mutate.mjs both`。古いページから書き戻さない（X-20）を変えたら `ONLY=QW21 M=MQ42,MQ43,MQ44 PORT=9950 node tests/mutants/mutate.mjs both`） |
| ミチビキ空港（games/michibiki/）の変更 | smoke ＋ `ONLY=FW6,FW7,FW8,FW9,FW10,FW11,FW12,FW13,FW14,FW15,FW16,FW17,FW18,FW19,FW22,FW23,FW24 node tests/run.mjs full`（ロジックだけなら `ONLY=FL1,FL2,FL3,FL4,FL5,FL6,FL7,FL8,FL9,FL10,FL11,FL12,FL13 node tests/run.mjs full`、約 20 秒。ルール・保存・出現を変えたら `ONLY=FL1,…,FL13,FW1,…,FW24 M=MF1,…,MF32 node tests/mutants/mutate.mjs both`） |
| もくもくこうば（games/seizai/）の変更 | smoke ＋ `ONLY=WW7,WW8,WW9,WW10,WW11,WW12,WW13,WW14,WW15,WW16,WW17,WW18,WW19,WW20,WW21,WW22,WW23,WW24,WW25,WW26,WW27,WW28,WW29 node tests/run.mjs full`（ロジックだけなら `ONLY=WL1,WL2,WL3,WL4,WL5,WL6,WL7,WL8,WL9,WL10,WL11,WL12,WL13,WL14 node tests/run.mjs full`。経済・保存・閉じた間・船・注文を変えたら `ONLY=WL1,…,WL11,WW1,…,WW19 M=MW1,…,MW50 PORT=9640 WORKERS=2 node tests/mutants/mutate.mjs both`。10 個ずつ M を区切って流す。さいしょから（契約 §21）を変えたら `ONLY=WW25 M=MW61,MW62,MW63,MW64 PORT=8800 WORKERS=2 node tests/mutants/mutate.mjs both`。古いページから書き戻さない（X-20）を変えたら `ONLY=WW26 M=MW65,MW66,MW67 PORT=8800 WORKERS=2 node tests/mutants/mutate.mjs both`。かんな の速さ・もう強くできない つまり（契約 §23・SZ-08）を変えたら `ONLY=WL14,WW27,X1 M=MW68,MW69 PORT=8800 WORKERS=2 node tests/mutants/mutate.mjs both`） |
| ちきゅうを守れ！ほしくだき（games/asteroid/）の変更 | smoke ＋ `ONLY=KW8,KW9,KW10,KW11,KW12,KW13,KW14,KW15,KW16,KW17,KW20,KW21,KW23,KW25,KW26 node tests/run.mjs full`（ロジックだけなら `ONLY=KL1,…,KL23 node tests/run.mjs full`。ルール・保存・中断・画面の流れを変えたら `WORKERS=3 PORT=9650 ONLY=KL1,…,KL23,KW1,…,KW26,X1 M=MK1,…,MK83 node tests/mutants/mutate.mjs full`（全部で 1 時間あまり。直した所の MK だけに絞ってよい）。KW3（はね返し）を変えたら 20 回続けて流して 0 回落ちることを確かめる（T-19）。ロジックの数値を変えたら main.js の gostar の表 `ARMS` も測り直す（design.md §10.68）） |
| あまいものあつめ（games/amai/）の変更 | smoke ＋ `ONLY=AL1,AL2,AL3,AL4,AL5,AL6,AL7,AL8,AL9,AL10,AL11,AL12,AL13,AL14,AW5,AW6,AW7,AW8,AW9,AW10,AW11,AW12,AW13,AW14,AW15,AW16,AW17,AW18,AW19,AW20,AW21,AW22,AW23,AW24,L12,L13,V13,X1 node tests/run.mjs full`（ロジックだけなら `ONLY=AL1,…,AL14`。変異は中身の仕組みを変えたときだけ `M=MA1,…,MA31 node tests/mutants/mutate.mjs both`） |
| 遠隔テストの中継（tests/relay/・common/debug-relay.js・common/debug.js の relay の部分） | smoke ＋ `ONLY=RL1,RL2,RL3,RL4,RL5,RL6,RL7,RL8,RL9,RL10,RL11,RL12 node tests/run.mjs full` を Chromium と WebKit（`BROWSER=webkit WORKERS=1`）の両方で。ONLY は番号を並べる形（`ONLY=RL` では絞れない）。約 30〜50 秒 |
| 公開前（master へ反映する前） | `node tests/run.mjs full` ＋ 下の「実機確認リスト」 |
| テストを変えたとき・中身の仕組み（点数計算・保存・日付・ルール）を変えたとき | `node tests/mutants/mutate.mjs both`（そのゲームの分だけ。テストがわざと入れた不具合を見つけられるか） |

- **公開の条件**は Chromium smoke・full（WORKERS=3。v38 から。自宅 PC は CLAUDE.md 5 章の目安）と WebKit smoke（画面あり：`HEADED=1 BROWSER=webkit WORKERS=1 xvfb-run -a node tests/run.mjs smoke`）の合格。変異テストは中身の仕組み（点数計算・保存・日付・ルール）を変えたときだけ、そのゲームの分だけ流す。表示・見た目・文言だけの修正では流さない。
- **smoke**（約 110 確認）：データが消えない・メニューへ戻れる・ボタンが画面内（最も狭い／最も低い画面）・オフラインで開く・更新で旧キャッシュが消える・基本操作・効果音のオン/オフ・ダブルタップ抑止など、壊れると困るもの。
- **full**（約 280 確認）：smoke ＋ 境界値（CSS の切り替わり・桁数・0.8 秒・3 秒）、ペアワイズの 12 画面、操作の細部、全部の効果音、タッチ操作一式。

### グループ

| ID | グループ | 中身 |
|---|---|---|
| L | 計算ロジック・静的検査（Node） | 2048 の合体・詰み・乱数・盤面検証、キリトリ道場の判定（線分と円・得点・コンボ・ライフ・軌道・経過時間基準）、sw.js・manifest・HTML・メニューの GAMES。L11（X-24・X-22）は notice.js が APP_FILES に入り、8 本が読み、`reloadIfStale` の中（`location.reload()` の前）で `markReload()` を 1 回だけ呼ぶ（さいしょから では呼ばない）こと、notice.js を偽の `sessionStorage`・`location`・`document` で動かして印あり・同じ path のときだけ 1 つ足して印を消すこと（壊れた環境でも落ちない）、8 本の `changedElsewhere` の前に X-22 の注意書きがあること。L13（X-26、v44）はいろびん以外の 11 本の head（description・og:*・twitter:card が 1 つずつ・og:url はそのゲームの場所・og:image はメニューの絵・`<title>` より前・文頭が「広告なし・登録なし。」・og:title は「名前｜ゆびあそび」・2048 の字なし）。L12（IB-32、v41）はメニューといろびんの head（description・og:*・twitter:card が 1 つずつ・絶対 URL・`?` なし・`<title>` より前・絵が手元にあり PNG の頭で 1200×630・300KB 以下・文頭が「広告なし・登録なし。」・メニューの「N こ」が `GAMES` の数と同じ） |
| D | データ保護・互換 | 途中経過・ベストの保存（キリトリは D10）、壊れた／古い保存データ |
| E | 閉じ込めなし | どの画面・カードからもメニューへ戻れる（キリトリは E6）、低い画面でカードのボタンに届く、メニューが最近遊んだ順に並ぶ（E7・E8。X-21。Ctrl・Meta・Shift・Alt つき・中ボタンのクリックでは入れない。X-23） |
| S | オフライン・更新 | Service Worker：オフライン起動、旧版からの更新、遅い回線・無応答（3画面）、新しい版との食い違い |
| V | 画面外・押せる・桁数 | 端末×向き×起動方法×画面（4画面）のペアワイズ、CSS の境界、7 桁のスコア。V2 は SE 横 Safari（568×270）のブロック・ピカッと 4 人が重ならない（X-17）。V1・V12 のスコア欄は文字の範囲の縦を行の高さで切り詰めて測る（T-13）。V12 はブロックの LEVEL・LINES 5 桁（99999）を 15 画面で確かめる（X-18。高さ 319 以下の横持ちはスコア欄を 162px に広げる）。V13 はメニューのベストの最大の桁（全部のゲームの「ありうる長い記録」が SE 縦・SE 横・iPhone 13 縦で「…」で切れず 2 行まで、ゼンマイの「45 / 45」は行の途中で割れない。MT-02）。V14 は最初のカードが SE 縦横 4 画面でスクロールなしで押せる・遊び方の表の説明の欄が潰れない（X-15・PK-39）。V15（X-27、v44）は SE の Safari（縦 320×454・横 568×270）で、まだ見ていなかった遊ぶ画面（2048 縦横・ハシわたり縦横・ブロック縦・キリトリ縦横・ピカッと 4 人 縦横）のボタンが画面内・重ならない・44px 以上。V16（v44）はまとめてポンとキリトリ道場の遊び方のキーの説明が、指だけの画面（`isMobile`・`hasTouch`）では出ず、マウスのある画面では出る（ハシわたり HS-05 の横展開）。V8（ブロックのスコア欄 4 桁・13 画面）は V12 と同じ画面・もっと長い桁で確かめているので v38 で消した（欠番） |
| P | 遊べること | キー・ボタン・スワイプ、0.8 秒の待ち、クリア、演出、キリトリの切る・落とす・爆弾・コンボ（P8・P9） |
| A | 効果音 | 音名の一致、操作で鳴る（キリトリは A6）、オフなら鳴らない、メニューの tap。A7 は♪の読み上げの名前（全部のゲームで aria-label は状態によらず同じ・オン／オフは aria-pressed だけ・ariaSnapshot にも オン／オフ が出ない。X-25）。A8 は同時発音の上限を使い切っても結果の音は鳴る（MT-03。smoke・node） |
| T | タッチ操作 | ダブルタップ拡大の抑止、タッチでの音の準備（unlock）、操作一式（キリトリは T6） |
| I | いろコード | logic.js（score・乱数・日付・保存データの検証）を Node で直接、画面（基本操作・保存・メニューへ戻れる・画面内・オフライン・境界値・色覚・効果音・ダブルタップ抑止・日付の変わり目・最大値・保存不可・日付の仕様） |
| ZL | ゼンマイさんぽ 計算ロジック（Node） | `games/zenmai/logic.js`・`stages.js` を直接呼ぶ：15 ステージの形と★3 が取れること、simulate・starsFor・bestTurns・validateProgress の境界値、ZL7 はネジの入力 input.js（持ち替え・cancel・速い回転・中心付近）（zenmai-logic.mjs） |
| Z | ゼンマイさんぽ 画面 | ZU0 静的（DOM・読み込み順・sw.js・音名）／ZU1 データが消えない・壊れた保存／ZU2 メニューへ戻れる・遊び方／ZU3・ZU11 ボタンが画面内・44px／ZU4 オフライン／ZU5 1 ステージクリア／ZU6 境界値／ZU7 ＋/－/歩かせる だけで遊べる／ZU8・ZU13 円ドラッグ（CDP）／ZU9 効果音／ZU10 ダブルタップ抑止（CDP）／ZU12 最後のステージ・全 15 ステージ・動きを減らす設定／ZU14 警告の基準（ネジと舞台・限界の1回転手前）・止まった後のゲージ・「つぎ」の目印・初回の遊び方（zenmai-ui.mjs）。ZU17（X-14）は人形が ★3 の範囲の先まで歩いて ★3 にならないとき、歩いている間に 1 回だけヒントが「★3の はんいを すぎたよ。もう ★3 は とれないよ」になる（舞台の高さは変わらない・やりなおしで元に戻る・★3 の回と手前で止まる回では出ない・SE 縦横で収まる） |
| PK | ピカッと早押し | logic.js（Node：勝ち・フライング・負の時刻・3点先取・5回・引き分け・redoRound・validateBestSolo）、input.js（Node：受付の窓・pointerId・キー・timeStamp）、静的（APP_FILES・読み込み順・音名）、画面（よーい・一時停止・回数表示・ベスト更新・終わり方）、保存（bestSolo）、戻れる、配置（隅が重ならない・2人は対角）、最大桁、効果音、ダブルタップ抑止、オフライン、実イベント（pointercancel・Enter／Space）（PK1〜PK18）。PK4 は結果カードの「メニューへ」が確認のカードを通して戻ることも見る。v31 の直し（full）：よーいの見た目・よーい中に押すと「いまは おさなくて いいよ。まってね」（フライングにしない）・設定の説明がモードで変わる・遊び方のやさしい言葉（PK19。PK-31・PK-32・PK-34）、対戦の途中で点が消えるときだけ「メニューへ」を確かめる（つづける／メニューへ もどる、フォーカスはつづける、出た直後 400ms は「メニューへ もどる」を押せない＝「メニューへ」の2度押しで点が消えない（R2））・「？」のカードにも「メニューへ」・点なし・れんしゅう・最終結果では確認なし（PK20。PK-33）、キーボード（閉じた後のフォーカスが body に落ちない・Enter と Space の押しっぱなしの repeat を無視（Space も repeat の keydown を何度か起こして確かめる。R3）・最終カードを待つ間の「？」が勝手に閉じない。PK21。PK-35）、#hint は変わった行だけ更新・音ボタンは aria-label「音」固定で aria-pressed だけ・黄の上の枠 3:1 以上（白 5px の内側に #111 3px）（PK22。PK-36・PK-37）。勝ち負けは pressFor(idx, ts) で確かめ、早送り中の実タップでは見ない（event.timeStamp は早送りされないため） |
| HL | ハシわたり 計算ロジック（Node） | `games/hashi/logic.js`・`course.js` を直接呼ぶ：押した時間⇔茎の長さの境界と逆関数、resolve の端ちょうど・ぴったり・missBy・おしい、ボーナス 1→2→4→8→16→16、いのちと over、イミュータブル、コースの公平さ、validateBest・recordBest・validateFlag、読み込み順の誤り（HL1〜HL8）、ぴったり 3 回で ♥ +1（`HEAL_EVERY`・上限 3・ステージは無し・`nextBonus`・`healIn`。HS-09。HL13）、ひとつ飛ばし（2つ先の端ちょうど・2つ分＋おまけ・ぴったりと重なる・間と行き過ぎは落ちる・届く所は画面の中。HL9）、高さの差（斜めの長さで届く・届かない・高い葉に短すぎ・どこまでもは平ら。HL10）、ステージ（K・難しさの上がり方・上限 50・同じ並び・公平さ・クリア・落ちたら最初から・ゴールの先へは飛ばせない・validateStage・recordStage。HL11）、旗（5 枚ごと・ゴールは旗にしない・落ちたら最後の旗から同じ並び・ひとつ飛ばしで旗を越えても取る・5 枚のステージは旗なし・どこまでもは旗なし）と落ちた所の言葉 zone（short・long・between・aim・over。HL12）（hashi-logic.mjs） |
| HW | ハシわたり 画面 | DOM と `window.HashiGame`（getState・holdFor・lenToCross・setRandom・skip）で：渡る・表示の一致、落ちる・いのち・もう一度、ベストの保存、戻れる、画面内・横向きの重なり、中断（hidden・遊び方）、キーボード、タイマーの片付け、時計、効果音、ダブルタップ抑止、設定、オフライン（HW1〜HW13）、タップ式（HW14）、ひとつ飛ばし（lenToSkip・とばしの案内と音・SE 縦横で届く所が canvas の中。HW15）、ステージ（はじめの「どっちで あそぶ？」・わたった n/K・最初から・クリアのカードと hashi.stage・つぎへ・どこまでもは今どおり。HW16 smoke）、クリアの演出（clearFx・タップで早送り・400ms・隠すと止まる・動きを減らす・キーボード・壊れた hashi.stage・SE 縦横の高い葉とカード。HW17）、旗（5 枚目で「はた！」と音・数字が跳ねる、旗の後に落ちると「どこから やりなおす？」のカード（さいごの はたから・さいしょから・400ms）、ひとつ飛ばしで旗を越える、「とばし！ 2まい すすんだ」、旗は保存しない、5 枚のステージはカードなし。HW18 smoke）、レビュー後の直し（SE 縦横でカード・案内の文が語の途中で折れない・クリアカードの2行・ボタンの文・短い遊び方がスクロールなしで見える・落ちた所の言葉・花火（同時3発・1発ごとに音・蓮は枚数ぶん・CPU 4倍遅くで描画 34ms 以内）・ステージ 1 から高さの差・茎の上の余白 8px。HW19）、v31 の直し（隠す・遊び方で案内が残らない・茎が最大で grow を止め tap と光で知らせる・短すぎる押下の案内・最後のいのちは sinking でぽちゃんの後にカード・data-holding は main.js だけ・最大のまま隠しても案内が「ながく おして、はなしてね」に戻る（R1）・結果の見出し「Nまい わたった！」と 0 回・設定の説明（読み上げの名前は「ゆっくりモード」などだけで、オン／オフと ○● は入れず aria-pressed で状態。R4）・iPhone ではキーボードの行なし・カードの間 #playView は inert で #sr は外・閉じたら #stageWrap へフォーカス・♪の名前は「効果音」だけ・影とぴったり印が 3:1 以上。HW21）、グラデーションを毎フレーム作らない（HS-10。HW22）、v37 の倍々と回復の案内（どこまでもで落ちたあとぴったりを 3 回続けると ♥ が 1 つ戻る・満タンでは戻らない・案内は SE 縦横で 2 行以内・遊び方の言葉。HS-09。HW23）（hashi-ui.mjs）。タップ式（hashi.tap）は HW14、読み上げは #sr（aria-live=polite、結果ごとに1文。#hint は読ませない）、`HashiRender.layout(W, H, viewW, maxLen, lift)` は縮尺の純粋な関数（HW19 が使う）、`HashiInput.createCore` は onHoldStart が false を返したら down も false（押していないことにする。HW14）。初回だけ自動で出る遊び方は短い3行（#card[data-help=short]）、設定のある詳しい版は「？」（data-help=full）。開くと出る「どっちで あそぶ？」は、テストの gotoH が mode（既定 endless）のボタンで選ぶ |
| BL | いろびん 計算ロジック（Node） | `games/irobin/logic.js` を直接呼ぶ：定数・COLORS（10色で色と記号がすべて違う）・paramsFor が面の表どおり（境界と壊れた値）、pourCheck・applyMove の決まりと reason の順・注ぐ量（見えている同じ色の続きと空きの小さい方）、そろう・届ける・届けた瓶は消える（瓶が1本減り空き瓶は増えない・残りは詰めて id は変わらない）・待ち瓶・連鎖の順・全部届けて won、イミュータブルとおかしな引数、生成（1〜60 面と 1000 面が決定的・各色4段・最初からそろった瓶なし・隠れの形・solutionIds を再生すると won・合計3秒以内・1 面は最初の手で詰まない）、ソルバー（解けない盤・待ち瓶がある盤で手の位置がずれない・布の無い面では注文の順で解けるかどうかは変わらない・上限で exhausted）、保存の検証（validateBest・validateSave の v:3 と古い v:2・v:1・makeSave・recordBest・validateFlag・replay は瓶の id）、詰み、隠れた色、静的（音名 unveil を含む・読み込み順・APP_FILES・メニューの名前が NAME と同じ）、BL11 は生成した面の解を通して瓶の本数・空き瓶・id・途中保存の再生。布の瓶（契約 §17）：BL12 は pourCheck の covered の順・布の瓶へ／から注げない・届けた数が cover に届いた手で unveiled（1人早くは取れない）・空き瓶の布で空き瓶が増える・隠れの面は一番上だけ・ソルバーも布を考える、BL13 は 1〜2000 面の生成（布の表・中身は空き瓶か4段で同じ色4段なし・cover とその幅（§17.9）・25〜600 面の布の面の半分以上で布が効いている・solution を再生すると won で布は全部取れる・fallback 2 なし・1面 300ms 以内）、BL14 は保存 v:3 の途中保存（布が取れる前・後）の再生と v:2・v:1 の手を捨てる。BL15 は makeSave は最初の 2000 手まで・予備の面も verify（IB-09・IB-11）v37 の新しい仕掛け（契約 §19）：BL16 はちいさい びん（3 段まで・3 段そろっても栓にならない・布の面に出さない・ほかの面は前と同じ。IB-29）、BL17 はいろ きまりの びん、BL18 はかぎの びん、BL19 は出し方と生成（paramsFor の表・41〜600 面が全部作れて解ける・1 面 50ms 以内・保存 v:3 で同じ局面）、BL20（full）はわな手の割合が帯ごとに上がる（BL1〜BL20、irobin-logic.mjs）。BL21（IB-08）は 1〜600 面の解の道の 2 人いる全局面で 2 つの枠の動物が違う・先に来た方は変わらない・2 引数の結果は v38 と同じ（指紋 `0fab5405`）・壊れた 3 番目の引数でも例外なし。BL22（IB-12）は `GEN_NODE_BUDGET` が 100000 で、局面の多い 3 面（3792・494・100260）が v42 の面（指紋 `74b04ac3`・局面 57945・32767・45111。v41 までは 1334・4774・100878 面の `9852e4a9`）。BL23（IB-24、v41）は `milestoneFor`（5 面ごとの節目・次の予告 NEWS が面の表とずれていない・壊れた値と大きな値ですぐ返る・凍結）、BL24（IB-33、v41）は布が 5 面から（5 面は中身あり cover 1・6・7 面は空き瓶・指紋 `ceb50cdd`／`c5a4728b`・5〜7 面の solution が解ける）。直した項目：BL6 は布の無い 3・4・27 面、BL13 は 5〜24 面に布、BL19 は 5〜7 面を除いた 69 面（指紋 `4c324cd0`。v42 から 1〜60 面の 47 面 `f08fb003` と 61〜200 面の 26 面 `cca8d0a9` に分けた。局面の上限 40,000）、BL1・BL13・BL17・BL18・BL23 は 10 色・12 本に合わせた。BL25（IB-43、v42）は 61 面から 10 色・瓶 12 本：(a) 1〜60 面は v41 と同じ面（指紋 `df5616e7`）、(b) むらさき・つき、(c) `paramsFor`（60 面 9 色・61 面 10 色）、(d) 61〜69 面の仕掛け（ちいさい びんは 61・65・69 面だけ 1 本）、(e) 61〜300 面が作れて解ける（fallback 0・12 本・色 0〜9 が 4 段ずつ）、(f) 60 面の節目の予告。BL26（smoke。IB-34、v45）は なかよしちょう（`irobin.book`）：読む（無い・壊れた 8 種・新しい版・使える分だけ）・0 から数える・addClear（数・段・星と手数は良い方・count false）・bookStep／nextStepAt・書いて読み直すと同じ・bookStars。BL27（smoke。IB-57、v47）は 錠の数え方 `lockProgress`：空の盤で 0・上に 2 つと 1 つの瓶で 2・隠れた同じ色／別の色が混ざった瓶／鍵・布・ちいさい びんの瓶は数えない・封をした瓶で 4・壊れた入力で 0 |
| BW | いろびん 画面 | DOM と `window.IrobinGame`（getState・pick・pour・solution・skip・setLevel・setState）で：注ぐ・表示の一致（隠れの段は data-color が空）、solution() で1面クリア・ベスト保存・next、途中の再読み込みと壊れた保存・ほかのゲームのキー、メニューへ戻れる、画面内（SE 縦横・iPad・11本の面・16桁・ヒントの高さ・カード）、お助け（1手もどす・やりなおし）、詰み、キーボード、中断（hidden・遊び方）、効果音の順、色覚（記号）、動きを減らす、オフライン、ダブルタップ抑止（CDP）、メニューのカード、詰み予備軍・届けの連鎖の長さ（6本以上の連鎖を 20 面から探す。布が同じ手で取れる手は除く）・めやすと★・遊び方の閉じるボタン（BW16）、届けた瓶の跡は空いたまま（画面の瓶が1本減る・残りは動かず位置が同じ・跡は押しても何もしない・data-index は state の位置／data-id と aria-label・数字キーの番号は置き場所＝id+1 で固定・空いた場所の数字キーは何もしない・矢印は跡を飛ばす・演出中に押した瓶が正しい瓶を選ぶ・再読み込み v:3）（BW17、smoke）、布の瓶（data-covered・data-cover-left・aria-label・押しても選べずヒントと deny・はじめての布のヒントと irobin.cloth・届けて布が取れる・音 unveil・「あきびんが でてきた！」・動きを減らす設定で 0.5 秒以内・再読み込み）（BW18、smoke）面の番号 4〜8 桁は 1 段のまま（IB-30）（BW21）。最後の手まで保存された面はクリアのカードから（IB-22。BW22）、- キー・もういちど・SE 横の遊び方・記号 12px（IB-10・17・19・21。BW23）、手 0 のやりなおしは disabled（IB-13。BW6）、待っているお客さんのまばたき・止まっている間に描くのはその間だけ・裏と動きを減らす設定ではしない（IB-16。BW24）v37 の新しい仕掛け：ちいさい びんの見た目・はじめてのヒント・3 つまで（BW25）、いろ きまりの びんの札とヒント（BW26）、かぎの びんの錠と開く演出（BW27）、遊び方の行と SE 縦横（BW28）（BW1〜BW28、irobin-ui.mjs）。BW29（IB-25）は詰み・予備軍の最初の 1 回だけ「とける ところまで もどす」のカード（出てすぐは押せない・押すと解ける最後の局面へ戻る・保存も同じ・「このまま つづける」・setState の詰み・SE 縦横）。BW30（IB-08）は 115 面と 110 面（v42 から。68 面は 10 色になって面が変わり場面が無くなった）を solution で遊び、2 人いる全局面で画面の動物の名前が違う。BW7・BW16 は rescue カードを閉じてから確かめる（基準は変えていない）。BW31（smoke。IB-33・IB-31、v41）は 1 面と 5 面の最初のヒント・クリアカードの動物の列・ボタンの並びと間・★3 と節目だけ出る「ともだちに おしえる」（share・clipboard を差し替えて、文・URL・失敗の順）・知らせが出ても「つぎの めんへ」が動かない・SE 縦横で収まる。BW32（smoke。IB-24、v41）は記録の行（節目だけ「あたらしい きろく！」と音 best、ほかは「ここまで ○めん」で音なし）と予告の文、テンポ（900ms・400ms）が変わっていないこと。BW33（full。IB-43・IB-44、v42）は 61 面（瓶 12 本）と 40 面（11 本）が、SE 縦横のホーム画面と Safari・13 横・iPad 縦横で、瓶が 44×44 以上・#board の中・#shop／#hint／#tools／.head と重ならない・記号 12px 以上、むらさきは「つき」の記号、= と ^ キーで 12 本目、遊び方の .note、60 面のクリアで「つぎは 61めん。いろが ふえるよ」。BW34（full。IB-36、v44）は はじめての遊び方カードが短い（項目 2 つ・130 字以下・SE 縦 Safari でスクロールなしで「わかった」を押せる・best 4／11／39 で「ぬのの びん」「？」が増える・キーの説明はキーボードのときだけ。Chromium のみ）。BW35（full。IB-45、v44）は 109 面と 101 面で、かぎの錠が他の瓶・お客さんの棚と重ならない（SE 縦横 Safari・SE 縦ホーム画面・iPhone 13 縦・iPad 縦）・記号 12px 以上・iPhone 13 縦と iPad は幅 26px のまま。直した項目：BW5・BW16・BW29 は 4 面、BW18 は「ぬのが とれる」の文。BW36（full。IB-34、v45）は クリアで動物の数・星・手数が残る・前から遊んでいる人も 0 から数える・開き直したクリアのカードで二重に数えない・壊れた帳面でも落ちない・新しい版の帳面を書きかえない・古いページから書き戻さない（X-20）・帳面を次の面の保存より先に書く。BW37（full。IB-34・IB-41・IB-42、v45）は 段が上がった面の一言と音 best 1 回・お店の動物の data-dress・なかよしちょうのカード（SE 縦横のホーム画面と Safari で押せてはみ出さない）・もどるでクリアのカードへ・ホーム画面に追加していないときだけ一言・105 面の予告「あと ○にんで」・絵 6 匹 × 段 0〜3。BW31・BW32 はクリアのボタン 4 つ（next・menu・book・share）に合わせて直した。BW38（full。v46、なかよしちょうのドレスアップ）は 札ごとの「おしゃれ ★☆☆」のしるし（★ の数が data-step と同じ・aria-label「おしゃれ N こ／3こ」）・段 3 の札だけ done（王冠は読み上げに出ない）・4 つの帳面（空・途中・全部 1000・ペンギン 1000001）× 6 画面（SE 縦横のホーム画面と Safari・13 縦・iPad 縦）で、ホーム画面はスクロールなしで収まり下に 4px 以上の余白、Safari は「もどる」がスクロールなしで押せる・絵 50px（SE 縦）・46px（SE 横）・80px（大きい画面）・字 12px 以上・動きを減らすと札の動きが止まる。BW39（full。IB-57、v47）は 101 面で 錠のそばの「N/4」が lockProgress と同じ・重ねると増える・錠の瓶を押すと吹き出し「[記号] を 4つ かさねると あくよ（いま Nつ）」が 4 秒で消える（押し直す・ほかを押しても消える）・下の一言と読み上げも同じ言葉・SE 縦横のホーム画面と Safari で重ならない・12px 以上・動きを減らす設定でも出る。BW27 の言葉は「4つ かさねる」に直した |
| QL | まとめてポン 計算ロジック（Node） | `games/matomete/logic.js` を直接呼ぶ：定数・COLORS、かたまり（上下左右・斜めは別）・1個は消せない、(n−2)² と全部消し +1000、落下と左詰め、終わりの判定、同じ種で同じ盤・最初から消せない盤を出さない、replay・保存の検証、イミュータブル・例外を出さない、1000 回の乱数プレイで不変条件（3 モード）、モードの記憶・のこりの記録・「おしい」の線（QL10）、§10 の まわりも消える・れんぞく・preview（QL11）（QL1〜QL11、matomete-logic.mjs） |
| QW | まとめてポン 画面 | DOM と `window.MatometeGame`（state・tapCell・select・remove・undo・restart・newSeed・cellRect・isAnimating・skip）で：2回タップ（1回目は選ぶだけ・札「n こ ＋p てん」・data-selected・選び直し・盤の外と空のマスで選びをやめる・1個のマスはヒントと揺れ・消したあとの盤が別実装と同じ）（QW1）、保存（v:3・再読み込みで同じ局面と れんぞく・v:2・v:1 は同じ種の最初から・hidden で保存・壊れた保存 17 通りとベスト・保存不可・ほかのキー）（QW2）、どこからでも戻れる・遊び方は初回だけ（QW3）、静的：音名・読み込み順・APP_FILES（QW16、Node）、全部消し（種 187・お祝い・+1000・1620 点・カードの 0.6 秒ロック・終わった回を再開しない）（QW4）、終わり（ベストのキーの分け方・むずかしい⇔ふつう）（QW5）、お助け（1手もどす・U・さいしょからの確認）（QW6）、canvas の色＝state（はじめ・落下・左詰め）と cellRect（QW7）、画面内（SE 縦横・13 横・iPad・7 桁・12px・たてむきの案内・カード）（QW8）、キーボード（QW9）、動きを減らす（QW10）、効果音（QW11）、オフライン（QW12）、タッチの2回タップと拡大の抑止（QW13、CDP）、色覚・ベスト超えの目印（QW14）、メニューのカード（7 桁の 9,999,999 てん も省略せず 2 行まで。MT-02）（QW15）、やさしい・モードの記憶・のこりの記録・小さなお祝い（QW17）、2回目のずれ・明滅の停止・横向きのたてむき（QW18）、§10 まわりも消える（予告・波・れんぞく 2・ひろがる！・表示が消える・もどす／再読み込み・0.9 秒以内・動きを減らす）（QW19）、v34 の小さな直し（盤の外ならヘッダー・ヒント・点数の欄を押しても選びをやめる・？は遊び方を開く＝MT-01、568×270 の終わりのカードがスクロールなし＝MT-13、「れんぞく」の札が盤にかかるのは 10px まで＝MT-16）（QW22）v35 の小さな直し（「のこり」が 5 桁でも欄に収まる＝MT-17、SE 縦 Safari の終わりのカードがスクロールなし＝MT-18）（QW23）（QW1〜QW23、matomete-ui.mjs） |
| FL | ミチビキ空港 計算ロジック（Node） | `games/michibiki/logic.js` を直接呼ぶ：定数・COLORS（3色・hex と印が違う）・滑走路の置き方の決まり 1〜4・難しさの関数の境界（FL1）、v37 の置き方 3 通り（`PLAN_COUNT`・`RUNWAY_PLANS`・6 つとも決まり 1〜4・`newGame` の plan・1 機目・各置き方の着陸。MC-15。FL13）、直進・速さ・道をたどる・道の終わりで直進・間引き・MAX_PATH・reason・pickPlane（FL2）、着陸（区域と向きの境界の両側・wrongway は1回・入り直すとまた1回・区域の中で向きが直る・色違いと閉じた滑走路は素通り・着陸の動き中はぶつからない・guided と stats）（FL3）、ぶつかる・近すぎる・2組・3機・over・CRASH_BREATH（FL4）、跳ね返り（FL5）、色が増える・開いた直後の色・出る間隔・maxAlive・kindFor（FL6）、出現・左の辺の1機目・WARN_S・SAFE_SPAWN_D・辺の 15〜85%・決定的・Math.random（FL7）、保存の検証（FL8）、イミュータブル・例外なし・1000 種の不変条件（FL9）、autoplay の調整の目安（FL10、full。v37 で置き方 1・2 の straight も足した）、静的：読み込み順・音名・APP_FILES（FL11）、おまかせの道 240 通り（FL12）（michibiki-logic.mjs） |
| FW | ミチビキ空港 画面 | DOM と `window.MichibikiGame`（getState・manual・tick・drawPath・guide・spawn・restart など）で：なぞって着陸・逆向きは通り過ぎる（FW1、lib.mjs の `mbDrag`）、ぶつかる・♥・終わりのカードの 0.6 秒・もういちど・ベスト（FW2）、壊れた保存・保存不可・ほかのキー（FW3）、どこからでも戻れる（FW4）、hidden・遊び方で止まる（FW5）、画面内 8 画面・5 桁・倍率（FW6）、向きの変化（FW7）、キーボード（FW8）、タップでおまかせ（FW9）、効果音（FW10）、色覚の印とヒント（FW11）、動きを減らす・0.4 秒の停止（FW12）、色が増える（FW13）、遊び方（FW14）、タッチ（FW15、CDP）、オフライン（FW16）、メニュー（FW17）、性能（FW18、CDP）、矢印と逆向きのヒント（FW19）、契約 §19 の直し：うしろをつかむ・長押しはタップ（FW20、smoke）、すぐ保存・さいしょからの確認・#overTip（FW21、smoke）、pageshow（FW22）、2本目の指（FW23、CDP）、v37 の置き方：回ごとに前と違う置き方・描いた矢印が滑走路と同じ・変わった回の最初の案内（FW24）（michibiki-ui.mjs） |
| WL | もくもくこうば 計算ロジック（Node） | `games/seizai/logic.js` を直接呼ぶ：定数と表・式、流れ（つまり・bottleneck・木が尽きない）、応援とよびこみ、節目、大きな船、大口の注文、閉じた間（時計が戻る・0時またぎを TZ 2 通りの別プロセスで・壊れた日付・上限・半分の速さ）、保存、決定的・イミュータブル、1000 回の乱数の操作の不変条件（WL1〜WL10、smoke）、工程：かんそう・かんな の並びと使える段・いた は かわいた かくざい を使う・みなと は つるつるいた・v25 の形の保存を読んで止まらない（WL12、smoke）、道具の段階：TOOL_LV・TOOLS・toolTier の境目・toolOf の next・buy の toolUp は段が上がった買い物だけ（WL13、smoke）、かんな の直し：みなと で全部さいだい・はやい でも つまりが かんな でない・かんな の速さ（1ぷんに N まい）の式・もう強くできない部署 `maxedOut`・次の段で もっと強くできるか `moreNextStage`（WL14、smoke。SZ-08・レビュー S1）、自動プレイの目安（WL11、full。節目の直後 10 分の稼ぎを含む）（seizai-logic.mjs、担当A） |
| WW | もくもくこうば 画面 | DOM と `window.SeizaiGame`（getState・logic・advance・away・tapZone・buy・setState など）、`?debug=1` の命令（gostage・neworder・ships）で：遊べる・#money／#goalText／シートの値段が logic の関数と同じ・deny（WW1）、節目と #stageCard の 400ms・bgRedraws（WW2）、起動のるすの あいだ 90 秒・30 秒・3 時間・時計が戻る・壊れた savedAt（WW3）、0時またぎを日本とロサンゼルス・hidden→visible・二重に足さない・時計を戻す（WW4）、保存・10 秒ごと・bak・保存不可・ほかのキー（WW5）、どこからでも戻れる（WW6）、注文（WW7）、大きな船と最大の桁（WW8）、画面内 7 画面・遊び方（WW9）、性能（WW10、CDP）、中断と pagehide（WW11）、キーボード（WW12）、動きを減らす（WW13）、効果音（WW14）、メニュー・NAME・DG1・touch-action（WW15）、オフライン（WW16）、タッチ（WW17、CDP）、レビュー後の直し：遊び方の間だけ止まる・rAF だけが止まった間・押した部署が見える・advance＝step（WW18）、レビュー後の直し B：注文カードは最初の1回だけ自動で開く（2回目からは札と #hint）・シートを開いている間は閉じてから・おかえり が注文より先・おかえり／エンディングの文が見出しと重ならない・注文の札の文・最初の一手の「おして！」・森が止まったときの案内・買える印・広げるボタンの2段・節目カードの絵・マネージャーの1行・みなとで景色へスクロール（WW19）、待つ理由：なえぎのシートと読み上げに「きりかぶが まだ ないよ。きこりを ふやすと」・はこぶ・かわむき にも「きこりを ふやそう」・つまりの きこり には出ない・切り株まで歩いて植える（WW20）、新しい工程：かんそう・かんな の場所とシートの値段・つまりの札・節目カードの「ふえたもの」・みなと の めあて・v25 の形の保存（WW21）、道具：Lv4→5 の「のこぎりに なった！」・音 tool・lastTool・「つぎ：…（Lv15）」・全部署の名前が TOOLS と同じ・Lv 1・5・15・30 で絵が変わる（WW22）、画面を広く：SE 縦の上の帯 104px 以下・#scene 6 割以上・開いた場所の上 44px が見える・#scrollCue・横向きのシート（WW23）、はこぶ人の往復と「まち」：録画の局面（こうば）で 30 秒の間に門まで 3 回以上（`getState().carryTrips`）・はこぶ・かわむき・かくざい の「まち」（`getState().waits`）が出続けない・はこぶ のシートに待つ文なし・動きを減らす設定でも往復・本当に前の品が来ないときは「まち」・きこりが つまって切り株が ときどきしか できないときは なえぎ（猶予 3 秒）に「まち」（WW24）、さいしょから（契約 §21・SZ-07）：SE 縦・横で #helpOk・#helpReset・#resetNo・#resetYes が画面内・44px 以上・「やめる」が先で primary・やめる／Esc で保存が変わらない・実行で save と bak を消して開き直し best・help・save.v<n> は残る・開き直す前の pagehide で古い保存を書き戻さない・消せないときは #hint「けせなかった」（WW25）、もう強くできない つまり（契約 §23・SZ-08）：みなと で全部さいだい・はやい の局面で つまりが かんな でなく かんな のシートが「1ぷんに 849まい」・つまりの札（`getState().jamTag`）が「ぜんぶ さいだい！」・場所の data-maxed=1 と読み上げとシートに「おそい」が無い・ほかの場所に「〇〇を ふやそう」が無い・「もうかる」にすると「ここが おそい」に戻る・こうじょう で全部さいだい・はやい の つまり（みせ）は シート「つぎの だんで もっと ふやせるよ」で「これいじょう」と言わない（レビュー S1）（WW27）。もうかる／はやい の ✓ は見た目だけで読み上げの名前（ariaSnapshot）に入らず、状態は aria-pressed（X-25）（WW28）。smoke は WW1〜WW6（seizai-ui.mjs）。WW29（SZ-06）は はこぶ が速くて置き場がいつも 0 でも、はこぶ が働いている間は札が「すぐ はこぶ」、丸太が本当に来ないときは「0」、はこぶ の人がいなくて丸太がたまれば数字（札は丸太の山の上で、山と重ならない。SE 縦横で画面内） |
| KL | ちきゅうを守れ！ほしくだき 計算ロジック（Node） | `games/asteroid/logic.js` を直接呼ぶ（担当A・数値の調整担当が持つ）：式・星の形・当たり・はなれたかたまり・近づく・クリア・2択・保存・決定的・自動プレイの目安・不変条件・重さ（KL19 の greedy は壁の時計でなく CPU 時間で測る。T-20）・v40：いなずまの伝わり（KL20）・たまの伸びと通りぬけ（KL21）・どかんの中心（KL22）・Lv99 のたまの強さ（KL23・full） |
| KW | ちきゅうを守れ！ほしくだき 画面 | DOM と `window.AsteroidGame`（getState・logic・advance・upgrade・unlock・choose・reserveSwap・setState・save）、`?debug=1` の命令（win・lose・gostar・bench）で：遊べる・表示の一致（formatKakera・upCostOf・dpsOf・progressOf）（KW1）、2択（400ms・止まる・再読み込みで同じ候補）（KW2）、はね返し（lose は一番下を BARRIER_Y ちょうど・hold にするので 1 step で必ず bounce・「あと N%」・残る・自動で次。T-19）（KW3）、場を押しても何も起きない（fly・bounce・clear）（KW4）、クリアとエンディング（KW5）、保存 v:2・壊れた保存（v:3・欄だけ壊れた ひかえ・予約）・bak（KW6）、戻る（入れ替えのカードからも）（KW7）、区切り（KW18）、クリアの帯とベスト（KW19）、砲台と斜め撃ち（turretsOf の位置・等間隔・ang・斜めの弾・x が動かない・ひかえは撃たない・枠を開けると並び直す）（KW22）、古い保存 v:1（かけらだけ・bak・best は下げない・遊び方の先頭に知らせ 1 行 #helpMig、#hint には出さない・閉じたら消える。UX レビュー 4）（KW24）／full：画面内（最大の桁・3 台・4 台＋ひかえ・6 種類・場の高さ 4 台は 42%・30%・予約の札「つぎの ほしから」（入らない行だけ「つぎから」）・「とおい／ちかい」が場の中で砲台に重ならない）（KW8）、長い名前の折り返し（T-13 と同じ切り詰め）・遊び方（KW9）、性能（§21.5：星 30・4 台 Lv30・CPU 4 倍で遅いコマ 5% 以下・drawMs 8ms・stepMs 4ms）（KW10）、中断（KW11）、キーボード（4 台のあと U で ひかえへ）（KW12）、動きを減らす（KW13）、効果音（KW14）、メニュー・NAME の一致・説明「ほうだいが」（KW15）、オフライン（KW16）、タッチ（CDP）（KW17）、◎ と 2択の案内・gostar（KW20）、さいしょから（KW21）、ひかえと入れ替え（ひかえが空・4 台後は ひかえへ・残り 1 つは 1 枚・6 種類でボタンが消える・一度持った武器だけ・ひかえは強くできない・#swapCard の 400ms と止まる・予約の札・取り消し・星の途中は替わらない・再読み込みで残る・はね返しとクリアで替わる・Lv は武器ごと・音 swap・キーボード・SE 縦横）（KW23）、古いページから書き戻さない（X-20。x20Run・ヒントを出さない・見えている間は後勝ち・さいしょからの直後）（KW25）、v40：いなずまの絵 0.35 秒と てつ以外の枝・たまの しんか の言葉（Lv20 と Lv40・99）・いなずまの説明（KW26） |
| AL | あまいものあつめ 計算ロジック（Node） | `games/amai/logic.js` を直接呼ぶ：定数・10 色・paramsFor・絵 48 枚の決まり・ふち（ななめを数えない）・運ぶ・押す（reason の順・ふた・こおり）・生成（決定的・解を再生すると勝つ）・うごかせない・再生と 1手もどす・保存／ベスト／ずかん／「もどしなし」の検証・イミュータブル・性能（AL11, full）・自動プレイの表（AL12, full）・絵の選び方（AL13） |
| AW | あまいものあつめ 画面 | DOM と `window.AmaiGame`：押す・運ぶ・クリア・保存・メニューへ戻る（smoke AW1〜AW4）、画面内・1手もどす・うごかせない・はやく・中断・キーボード・音・色覚・動きを減らす・オフライン・拡大・メニュー・ずかん・X-20・性能・ふたとこおり・演出中にカードを開く（AW21）・演出中に離れて戻る（AW22）・1手もどし なし（AW23）・カードの間の inert（AW24）（full） |
| DG | デバッグ表示（common/debug.js） | 無効なら DOM・console に触れない（全ページ）、?debug=1 でボタン・エラーの件数・パネル・コピー用の文字、メニュー→ゲームでも有効、?debug=0 と「デバッグを終わる」で消える、命令（help・info・layout・state・storage・tap・logs）の形と安全なエラー、ボタンが全ページ（SE 縦横・最初の画面とプレイ中）で押せる要素に重ならない、パネルの文字 12px・ボタン 44px・touch-action、オフライン（DG1〜DG6、debug.mjs）。わざと起こすエラーには印 DGTEST を付け、X1 の集計から外す |
| RL | iPhone の遠隔テスト（中継） | `tests/relay/relay.mjs` を子のプロセスとして `--key` 固定・`--port 0`（空いているポート）・`--host 127.0.0.1` で起動し、Playwright のページを iPhone の代わりにつなぐ。PC 向けの窓口は fetch、`ask.mjs` は子のプロセスで呼ぶ。終わったら（失敗しても）中継を止める：起動 → `/status`・`/wait`・`/run`（info・layout・state・logs・時間切れ）・`/logs`（RL1）、合言葉ちがいは 4001・rejected・つなぎ直さない・形の悪い key は覚えない（RL2）、`open` でメニュー→ゲーム・`/wait?after=` で新しい接続を待つ・悪い path は断る・`reload`・移る先の URL に `debug=1&relay=1&key=` が付く・sessionStorage も残る（RL3）、中継を止めて起動し直すと自動でつなぎ直す（RL4）、relay を付けないときは debug-relay.js を読まない・`?relay=0` と「デバッグを終わる」・APP_FILES に入れない（RL5）、ask.mjs の `--yes`・終了コード 2・`名前=値`（RL6）、静的配信の安全（root の外・.git・301・405・Content-Type・no-store）とループバック以外 403（RL7）、2 台目で 1 台目が 4002（RL8）、Node だけの偽の端末で枠の読み方・ログの切り詰め・hello 前の上限・`--exit-on-stdin-close`（RL9）、なりすまし対策（別の Origin・名前の Host は 403、合言葉 5 回間違いで締め切り、既定の合言葉 8 文字、hello 前 8 本まで）（RL10）、open・reload で sessionStorage が消えていても移った先でデバッグが有効になりつなぎ直す・URL に `debug=1&relay=1&key=` が付き path の `?` と `#` は残る（RL11、T-11）、Node だけ：iPhone で開く URL の並び（ふつうの LAN が先、仮想（アダプタ名・192.168.56.x・172.16〜31.x・169.254.x.x・MAC の先頭）は後ろで印、先頭に「おすすめ」）（RL12、T-12）。smoke は RL1・RL5（relay.mjs）。中継を止めている間の「WebSocket につながらない」console だけは X1 に数えない |
| X1 | 共通 | 全ページでコンソールエラー 0（最後に 1 回） |

## 構成

```
tests/
  run.mjs          実行（グループの並列・結果の表示）
  lib.mjs          共通部品：Playwright の読み込み、サーバー、端末と safe-area、待ち時間の早送り、タッチ操作、
                   画面の共通確認（layoutProbe）、古いページから書き戻さない（X-20）の確かめ（x20Run・x20Text。T-14）、
                   合否の記録、既知の不具合（KNOWN_ISSUES）
  cases/           グループごとのテスト（logic, data, escape, sw, layout, play, sound, touch, irocode, zenmai-logic, zenmai-ui）
  mutants/         変異テスト（mutate.mjs）
  relay/           iPhone の遠隔テストの中継（relay.mjs＝中継サーバー、ask.mjs＝命令の道具。下の「iPhone の遠隔テスト（中継）の使い方」）
  design.md        設計と対応表
```

## 速くするしくみ

- **外部フォントの遮断**：Google Fonts は空の応答で即答（Service Worker の通信も）。ネットワークに左右されない。
- **グループ単位の並列**：既定 3 並列（v38 から）。グループごとに別のプロセス・別のポート・別のブラウザなので、オフラインや遅い回線の再現が他に影響しない。
- **待ち時間の早送り**：Playwright の `page.clock` でページ内のタイマーを置き換え、`wait(page, ms)` で一気に進める。**0.8 秒の境界（P2 前半）・Service Worker の 3 秒（S）・音の同時発音数（A2・A5）・スクロール（E5・P7）は実時間**のまま。

所要時間（この環境の Chromium、4 コア。同じ版で計測）：

| | 並列なし・早送りなし | 並列なし・早送り | 4 並列・早送りなし | **4 並列・早送り（既定）** |
|---|---:|---:|---:|---:|
| smoke | 33.9 秒 | 25.1 秒 | 12.6 秒 | **10.5 秒** |
| full | 173.4 秒 | 127.3 秒 | 49.9 秒 | **42.5 秒** |

どの組み合わせでも合否は同じでした（smoke 23/23、full 51/51 合格。既知の不具合の表示は同じ）。

キリトリ道場を足した版（feature/kiritori、2026-10）：smoke 29/29・full 61/61 合格（Chromium）。項目が増え、道場の canvas の描画（早送りしてもフレームごとに計算される）もあるため、同じ機械でほかの作業が動いていないときの目安は smoke 約 20 秒・full 約 75 秒（目標の 15 秒・60 秒を超える）。計測した時間帯は別のテストが同じ機械で並行して動いていて（load average 約 15）、smoke 28 秒・full 95 秒だった。時間を詰めるなら、P9（コンボ・爆弾まで遊ぶ、約 15 秒）と S4・S6（実時間の 3 秒待ち）が大きい。

A5（メニューの pointerdown の処理 ≤16ms）は、負荷の高い並列実行の中で 1 回だけ 16ms を少し超えることがあるため、S6 と同じ考え方で「16ms を超えた回があれば 6 回の測定を最大 3 巡まで繰り返し、いちばん速い巡の最大値で判定」にした（基準の 16ms は変えていない）。なお A5 を単独で流すと（`ONLY=A5`）、ブラウザで最初の AudioContext を作る 1 回目が 30〜40ms になり、master（167df81）でも不合格になる。full では先に A2〜A4 が音を鳴らしているのでこの差は出ない。
参考：一時フォルダにあった元のスイートは smoke 17.4 秒・full 110.4 秒（項目は今より少ない）。full の残りの時間の大半は S4・S6（Service Worker の 3 秒待ちを実時間で確かめる）です。

項目ごとの秒数の取り方：`JSON=<ファイル>` を付けて流すと、JSON の `items[].ms` に項目ごとの時間が入る（出力の `PASS  WW24  37.0s` と同じ）。遅い順に並べるには `node -e "const j=require('<ファイル>');for(const i of j.items.sort((a,b)=>b.ms-a.ms).slice(0,10))console.log(i.id,(i.ms/1000).toFixed(1))"`。
v37 の計画の結果（4 コアのクラウド、full 385 項目）：WORKERS=2 で 506 秒・WORKERS=3 で 381 秒（25% 短い。ただし HW22 が 1 回落ちた。T-25）。遅い上位 10 個と重なりの候補 31 個の秒数は docs/plans/v37.md 4 章。
v38（4 コアのクラウド、full 398 項目）：WORKERS=3 を既定に（直した写しで 413・408 秒。v37 の関門 WORKERS=2 は 542 秒）。並列 3 の重さで落ちた HW22・HW10・HW12・WW23 は、描き直し（rAF）が実時間で届くのを待つ・Playwright の時計の巻き戻りでカードを閉じた直後の 300ms に押さない、に直した（T-25。docs/plans/v38.md 1 章）。
重なりの候補 11 個は V8 だけ消した（ほかの 10 個は、その項目にしかない確かめ（文言・44px・音・性能・保存）を持つ。docs/plans/v38.md 3 章）。

## キリトリ道場のテストのしかた

- **判定ロジックは Node で**（L7〜L9）：`games/kiritori/index.html` の script を vm で動かし、公開 API `window.KiritoriLogic`（`segCircle`・`comboBonus`・`swipePoints`・`loseLife`・`difficulty`・`launch`・`step`・`parseBest`）を直接呼ぶ。経過時間基準（60/120Hz で同じ位置）・軌道（頂点は上端から 12〜45%）もここで確かめる。
- **ブラウザでは本物のマウス操作で切る**：ゲームの様子は `window.KiritoriGame.snapshot()`（読むだけ。状態は変えられない）で読み、`lib.mjs` の `kiriSwipe`・`kiriSlash` が的の位置をなぞる。早送り中のページでは時間を止めたまま（`frozen`）snapshot を読み直してなぞるので、的が動いて外れることはない。T6 だけは CDP の指のスワイプ。
- `kiriAutoplay(page, cond, { lazy })`：爆弾をよけて的を切り続け、条件（爆弾が来た・的が 3 つ同時に飛んでいる など）まで遊ぶ。`lazy: true` は落ち始めた的だけ切る（同時に飛ぶ的が増える。P9 のコンボ用）。P9 は `fixedRandom` で出る順番を固定している。
- 道場は canvas で、早送りしてもフレームごとの描画は実際に計算される（ゲーム内 1 秒あたり実時間 約 0.2 秒）。長く遊ぶ P9 は描く面積の小さい SE 縦で流す。

## 既知の不具合の扱い

- `tests/lib.mjs` の `KNOWN_ISSUES` に、ID・内容・見つけた時期を書いて登録します。登録したものは不合格でも全体の合否に含めず、**毎回「△ 既知の不具合」として表示**します。
- 直ると「★ 既知の不具合が解消した」と表示されるので、そのとき登録を外します（外さないと、また壊れても気づけない）。
- 登録は「すぐには直さない」と決めたものだけ。直すつもりの不具合は登録せず、不合格のまま直します。

いま登録しているもの：なし（K-AST2 は 2026-10-23 に PM が 4 台の場の高さの目安を 4 割 2 分にしたので外した）。

解消したもの（ほしくだき）：K-AST1（SE 横・Safari（568×270）で武器の行の4行目・あたらしい ぶき が画面の下にはみ出して押せない。docs/issues-done.md の AS-T1）は、低い横画面の行を 44px にする直し（契約 §18.1 A）で解消し、登録を外した（2026-10-21）。

解消したもの：K1（iPhone SE を Safari で横持ち＝高さ約 270〜319px にすると、ブロックの DROP が LEVEL/LINES に、HOLD が NEXT に重なる）は feature/kiritori で直し（高さ 319px 以下の横持ちだけ HOLD 欄・スコア欄・NEXT 欄を低くする）、登録を外した。V2（smoke、568×270）・V3・V4（285・311・319/320 の境界）・V12（568×270・568×300 の桁数。v38 で V8 を消して V12 へ）で確かめる。K2（遅い回線・無応答で common/sfx.js をネットワークで待ち続け、表示が遅れる）は hotfix/k2（CACHE_VERSION v11）で直し、登録を外した。S4・S6・S7 で確かめる。

## 版を上げるとき（メニュー最下部の「v16・2026-10-18」）

版の表示は `common/version.js`（`version` と `date`）で、メニュー（index.html）だけが読む。Service Worker の更新の合図は `sw.js` の `CACHE_VERSION`。
**版を上げるときは、`common/version.js` の `version` と `date`、`sw.js` の `CACHE_VERSION` の3つを一緒に更新する**（日付は公開する日、`YYYY-MM-DD`）。
sw.js にも版を直接書く二重持ちにしているのは、import 先だけが変わる方式だと iOS Safari で更新の検知が確実か分からないため（sw.js 本体のバイトを必ず変える）。食い違いは L10 が不合格にする（変異 MV1〜MV3 で検出を確認）。
確認：smoke ＋ `ONLY=L10,S8 node tests/run.mjs full`。

## 日付・時計

日付や時刻を扱うゲーム（いまはいろコードの「今日の1問」）と、それを確かめるテストのための決まりです。点検（2026-10）で見つかった「実際の時計との比較」「UTC の環境だけで通る」「時計の指定の書き間違い」を繰り返さないためのものです。

1. **日付を決め打ちしない／実際の「いま」と比べない。** 日付を固定したいときは `newPage(..., { clockTime: zonedTime(tz, 2026, 10, 18, 12) })`（内部で `page.clock.install({ time })`）で時刻を渡し、期待値はその時刻から作る（`'2026-10-18'` のように、渡した時刻に対応する文字列）。ページの日付を Node 側の `new Date()`・`L.todayStr()` と比べると、23:59 台に流したとき 0 時をまたいで落ちる。
2. **日付を扱うテストは、タイムゾーンを2通り以上で。** `lib.mjs` の `TIMEZONES`（`Asia/Tokyo` と `America/Los_Angeles`）を回し、`newPage` に `timezoneId` を渡す。時刻は `zonedTime(tz, 年, 月, 日, 時, 分, 秒)`（そのタイムゾーンの壁時計の時刻にあたる `Date`）で作る。UTC のままだと、ローカル日付を UTC の日付に取り違える不具合（日本の 0〜9 時台に前日になる）が見えない。Node 側の単体テスト（I2 の todayStr）は、別プロセスを `TZ=…` で起動して確かめる。
3. **`newPage` の clock は opts の1オブジェクトに入れる。** 第5引数以降は無視されるので、早送りが効かず実時間で待つことになる（D7・P5・A3 が実際にそうなっていた）。
   ```js
   // 正しい
   await newPage(browser, V(), 'D7', { initScript: fixedRandom, clock: true });
   // 誤り：{ clock: true } が第5引数になり無視される。DOMException の引数などに紛れ込むのも同じ
   await newPage(browser, V(), 'D7', { initScript: fixedRandom }, { clock: true });
   ```
   早送りを足したら、`CLOCK=0` でも合否が同じことを確かめる。
4. **実時間で測る箇所は、理由をコメントに書き、境界に余裕を持たせる。** 実時間に頼るテスト（意図的。早送りでは確かめられない）：S4・S6（遅い回線・無応答で3秒の打ち切り。2.8〜4.8 秒、オンラインは 1 秒未満を2回開いて速いほう）、S4 の x-served-at（サーバーが付けた時刻）とテストの実時計の比較（サーバーとテストが同じ機械で動く前提）、A2・A5（音は AudioContext の実時間。A5 は押してから遷移までの ms）、P2 前半（詰んでからカードまで 0.8〜1.25 秒の境界）、E5・P7（スクロール・スワイプはブラウザ側の時間）、V6・V7（回転・見た目）。重い機械で境界を外れたら、まず負荷を疑い、境界を広げる前に原因を確かめる。
5. **日付の処理を足すときは、「0時またぎ」「時計を戻す」「保存データの日付検証」を同時に検査し、`mutants/mutate.mjs` に日付の変異を足す。** 0時をまたぐ（隠して戻る・確認／遊び方カードの表示中・確定の瞬間）、端末の時計が戻って記録が未来の日付になる、保存された日付が壊れている／未来、の3つを I14・I19・I3 の形で確かめ、todayStr を UTC 由来にする・月がずれる・自動差し替えを無効にする、のような変異（MD1〜MD8）が検出されることを確認する。

## テストを足すときのルール

1. **直した不具合の確認は、該当するグループ（cases/*.mjs）に足す**。同じコミットで。smoke に入れるか full にするかは「壊れたら困るか（データ・閉じ込め・画面外・オフライン・操作）」で決める（design.md §3）。
2. **一時フォルダに別のスクリプトを作らない**。確認用の使い捨てスクリプトは、あとで誰も流さず、期待値も古くなる（以前は 35 本になり、全部で 15 分かかっていた）。
3. **版数など毎回変わる値は決め打ちしない**。キャッシュ名・件数は sw.js から読む（`swInfo()`）。旧版の SW はサーバーの `swver` で作る。音の部品の数のような作りの細部ではなく、鳴らした音の名前など振る舞いで確かめる。
4. **一つの画面で見つかった問題は、同じ作りの画面にも確認を足す**（例：ブロックのダブルタップ抑止 → 2048・メニューも、ブロックの sfx.js 読み込みの遅れ → メニュー・2048 も）。
5. 画面サイズを足すときは、まず design.md §4 の同値クラスと境界に当てはめ、新しいクラスか境界でなければ足さない。
6. 待ちは `sleep` ではなく `wait(page, ms)` を使い、ページを `{ clock: true }` で開く（早送りされる。書き方は上の「日付・時計」の3）。実時間で確かめる必要があるもの（境界の時間・Service Worker・音）だけ `sleep` のまま。
7. CDP（Chromium 専用）を使う項目には `cdp: '理由'` を付ける（WebKit では対象外として表示）。CDP なしで書けるなら書く（T5 のように）。
   AudioContext が要る項目（A4）には `audio: true` を付ける。ブラウザに `AudioContext` も `webkitAudioContext` も無い環境（Windows 版 Playwright の WebKit）では、不合格にせず「対象外（環境に AudioContext が無い）」と表示する。OS 名では決めず、実際に調べる。Linux の WebKit・Chromium では今までどおり流れる。
8. 外部（インターネット）に出ない・リポジトリや作業ツリーに書き込まない・決まったポート以外を使わない（ただし RL は、中継を空いているポート（`--port 0`）で起動する）。
9. **古いページから書き戻さない（X-20）**：途中の保存を持つゲームは、表に戻ったとき（visibilitychange・pageshow）に保存が自分の覚えた文字と違えば、書かずに `location.reload()` する。裏へ回る（hidden）・閉じる（pagehide）ときの保存の前にも `staleOnHide()` で比べ直し、storage イベントが届く前に古い状態を書かない。reload は1回だけ。テストは pageshow を `new PageTransitionEvent('pageshow', { persisted: true })` で送って再現し、別のタブは同じ context の 2 つ目のページから書く（本物の storage イベント）。storage イベントが届かない場合は、同じページから localStorage を直接書き換えて再現する（各ゲームの X-20 の項目の (d)。もくもくこうば WW26 は (e)）。QW2 は setItem を見張る形に変えた。確かめる手順は `lib.mjs` の `x20Run(page, ctx, { key, newer, fp, hiddenWrite })` と、合否の文を作る `x20Text(r)` の1か所にある（T-14。以前は6ファイルに同じ写しがあった）。ゲームごとの違い（保存のキー・新しい保存4つ・中身の印・裏での自分の保存）は引数で渡す。
10. **メニューのカードは `nth()` でなく href で押す**：メニューは最近遊んだ順に並びが変わる（X-21）ので、`a.game[href="…"]` で押す。
11. ハシわたりで、カードを閉じた直後に池を押すときは passBlock（閉じたときのページの時刻から 350ms を確かに過ぎるまで待つ）を使う。重いと Playwright の時計が巻き戻り、wait の分だけ進まないことがある（T-25・T-26）。
12. X-20 の開き直しを足したゲームは、`x20Run` で X-24 の知らせ（`#yubiNotice`）も確かめる（開き直していなければ出ない・開き直したら「ほかの タブの つづきから はじめました」が 1 回出る・ふつうに開き直しても出ない）。
13. **`wait` は「少なくとも ms 進む」を確かにする**（T-26、v39）：前後でページの時刻を読み、足りなければ足りない分を進め直す（3 回まで。ページを移ったら何もしない）。重いと Playwright の時計が古い時刻に戻るため。長い `until` のあとに `wait` で数秒待つ所は `frozen` で囲む（WebKit で時刻が戻る。FW19）。時計を止める（`frozen`）前に、音の準備（AudioContext）のためふつうのタップを 1 回しておく（WW17）。

## Chromium・WebKit と実機の違い

| | Chromium（既定） | WebKit（`BROWSER=webkit`） | 実機の iPhone/iPad |
|---|---|---|---|
| エンジン | Blink | Safari と同じ WebKit（ただし Linux の GTK 版） | WebKit（iOS） |
| 素早い連続タップ・スワイプ・長押し | CDP で送れる | 送れない（`touchscreen.tap` だけ） | 指 |
| 画面の大きさ・safe-area | 寸法を指定、safe-area は `env()` を数値に置き換えて再現 | 同左 | 本物 |

### 画面の大きさの呼び名（ユーザー決定 2026-10-25「呼び名を直して」）

テストや文書で「SE 縦（320×568）」「SE 横（568×320）」と書いているのは、**「画面表示を拡大」を使ったときのいちばん小さい iPhone の画面**のことです。iPhone SE 第1世代（2016 年）は 10 年より前の機種でテストの対象ではありませんが、iPhone 8・SE 第2/第3世代を「画面表示を拡大」にすると同じ 320×568 になります（13 mini などは 320×693）。拡大表示を使う人（高齢の人など）の画面を守るため、この大きさは外しません。拡大表示を使わない、いちばん小さい iPhone は 375×667（iPhone 8・SE 第2/第3世代）です。「SE 横 Safari 568×270」は、その画面を Safari で横持ちにしてアドレスバーなどを除いた高さです。

WebKit では対象外にしている項目（CDP のタッチ操作を使うため）：

| ID | 内容 | 代わりの確認 |
|---|---|---|
| P7 | 2048 のスワイプ 24px の境界 | なし（実機確認） |
| E5 | 低い画面でカードを指で縦スクロール | E4（ボタンに届くか）は WebKit でも流れる |
| T1〜T4 | 連続タップの細部・タッチ操作一式・♪の連続タップと unlock | T5（dblclick・gesture・2 回目の touchend を止める）は WebKit でも流れる |
| S5 の一部 | フォント用キャッシュは 20 件まで | なし。WebKit では Service Worker 自身の通信を Playwright で差し替えられず外部に出てしまうため、Chromium だけで確かめる |

注意：WebKit では Service Worker を使う S グループで、ページが読む Google Fonts を Service Worker が実際にインターネットから取りに行きます（Chromium では空の応答に差し替え済み）。

WebKit（Playwright 1.56.1 の WebKit 26.0、Linux）での結果（2026-10）：

- smoke：21/21 合格（対象外 2：P7・T1）、約 20 秒。Chromium との合否の差なし。キリトリ道場を足した版（feature/kiritori）は 27/27 合格（対象外 2：P7・T1）。ほかのテストと並行した計測で約 66 秒。WebKit は描画が遅く、1 フレームで進むゲーム内の時間には上限（0.05 秒）があるので、キリトリを始めてから「ゲーム内で 1 秒たつまで」を待つ確認（S1・D6）は、決まった秒数ではなくゲーム内の時間で待つ。
- full（参考）：44/45 合格（対象外 6）。hotfix/k2（v11）では 46 項目中 A5 以外合格（S4・S6・S7 も合格）。ただし 4 並列の full では、まれに S1・S3・S7 のオフラインの確認で WebKit が「internal error」を出して Service Worker の登録ごと消えることがある（v10 の版でも同じ症状を確認。単独・負荷をかけた状態で流すと再現しない。Linux 版 WebKit の不安定さと考えられる）。**A5 だけ不合格**：メニューのカードを押したときの pointerdown の処理が 16〜45ms（Chromium は 16ms 以下）。最初の 1 回が特に長く、効果音の準備（AudioContext を作って鳴らす）の重さと考えられるが、Linux 版 WebKit の音の仕組み（GStreamer）による可能性もある。**実機の iPhone で「押してから画面が変わるまでが遅く感じないか」を確認**する（下のリスト 4）。既知の不具合 K1 は WebKit でも同じく出る（K2 は v11 で解消、WebKit でも S4・S6・S7 合格）。

### 実機でしか確かめられないこと

- **ダブルタップ・ピンチで画面が拡大しないこと**（テストは「拡大のきっかけになるイベントを止めている」までしか見られない。実際に拡大するかは iOS Safari の判断）
- **safe-area**（ノッチ・ホームバー・横持ちの左右）に本当にボタンがかからないこと
- **ホーム画面に追加して起動**（全画面表示・アイコン・名前「ゆびあそび」・オフラインで起動）
- **音の聞こえ方**（大きさ・高さ・重なり、消音スイッチで鳴らない、ほかのアプリの音楽を止めない）
- Web フォント読み込み後の表示（テストではフォントを遮断している）

### iPhone での不具合の見方（?debug=1 のデバッグ表示）

iPhone の Safari で「ボタンが押せない」「表示がずれる」「止まる」などが起きたとき、PC なしで原因の手がかりを集めて Claude に送る方法です。詳しい仕組み・命令の一覧は [docs/debug.md](../docs/debug.md)。

1. **Safari で開く**：アドレス欄に `https://harutonatu.github.io/game-no1/?debug=1` と入れて開く（ゲームを直接開くなら `.../games/irobin/?debug=1` のように後ろに `?debug=1`）。ホーム画面のアプリにはアドレス欄がないので、**Safari で**開く。
2. 画面の隅（ボタンと重ならない空いた所）に **「🐞 0」** の丸いボタンが出る。数字は、そのページで起きたエラーの数（赤くなったらエラーあり）。メニューからゲームへ移っても、同じタブの間は有効のまま（ページごとに 0 から数え直す）。
3. 不具合が起きる操作をする。起きた画面で **「🐞」** を押すとパネルが開き、エラーとログ（新しい順）、端末の情報（画面の大きさ・safe-area・ホーム画面アプリか・Service Worker と版・保存データのキー）が見える。
4. **「コピー」** を押す（「コピーしました」と出る）。Claude Code（またはチャット）に「iPhone で〇〇をしたらこうなった」と一言書いて、**長押し→ペースト** して送る。自動でコピーできないときは、パネルに出る枠を長押し→「すべてを選択」→「コピー」。
5. 終わったら **「デバッグを終わる」**（または `?debug=0` を付けて開く）。タブを閉じても消える（sessionStorage に覚えているだけ）。

注意：コピーした文字には、保存データの**キーの名前と長さ**（中身ではない）・端末の情報（User-Agent など）が入ります。メールアドレスなどの個人情報は入りませんが、送る前に目で確かめてください。ゲームの状態（点数・面など）は入ります。

### iPhone の遠隔テスト（中継）の使い方

自宅の PC を「中継役」にして、**本物の iPhone の Safari** の中のようすを、PC の Claude Code から読んだり動かしたりする道具です。計画は [docs/iphone-relay-plan.md](../docs/iphone-relay-plan.md)、やりとりの約束は [docs/debug.md](../docs/debug.md) の 5 章。

- **中継**＝PC が、iPhone と Claude Code のあいだに立つ「受付係」。iPhone の言い分を Claude Code へ、Claude Code の頼みごとを iPhone へ取り次ぎます。
- iPhone に入れるのは **URL だけ**（アプリは入れません）。Safari で URL を開くだけです。
- 答えは **JSON**（かっこと文字でできた、ふつうの文字で読める形）で出ます。

**使ってよい所**：自宅の PC と、自宅の Wi-Fi だけ。**会社の PC では使いません**（監視ソフトがあるため）。公共の Wi-Fi（カフェ・駅など）でも使いません。

#### 0. 準備（初回だけ）

1. スタートメニューから **PowerShell** を開く（Claude Code の画面とは**別の新しい窓**）。
2. `node -v` と打つ。`v` で始まる数字（例：`v22.1.0`）が出れば OK。「認識されません」と出たら、https://nodejs.org から LTS を入れて、PowerShell を開き直す。
3. `cd` でゲームのフォルダへ移る。自宅の例：

   ```powershell
   cd "C:\tools\vm\share\701．ゆびあそび\game-no1"
   ```

   エクスプローラーでそのフォルダを開き、アドレス欄に `powershell` と打って Enter でも、そのフォルダで開けます。
4. **この窓は、中継を使う間ずっと開いたまま**にします（閉じると中継が止まります）。

#### 手順

1. **PC で中継を起動する**（0 の窓で）：

   ```powershell
   node tests/relay/relay.mjs
   ```

   起動の表示の見方：

   | 表示 | 意味 |
   |---|---|
   | 1 行目 `RELAY_READY …` | テスト用。気にしなくてよい |
   | 合言葉 | 乱数の **8 文字**（英小文字と数字。例：`26g5xuu3`）。起動するたびに変わる |
   | iPhone の Safari で開く URL | iPhone に入れるもの。例：`http://192.168.1.23:8790/?debug=1&relay=1&key=26g5xuu3` |
   | この PC で開く URL | PC のブラウザ用（`127.0.0.1`）。確かめ用 |
   | 止めるときは Ctrl+C | 終わるとき（下の「終わるとき」） |

   **URL が複数出るとき**は、一番上の「← おすすめ」を使います。「（仮想のネットワーク。ふつうは使わない）」と付いたものは iPhone から届きません。命令 `open`・`reload` で移ると、移った先の URL に `?debug=1&relay=1&key=…` が付きます（移った先でもつながったままにするため）。

   **IP アドレスの URL が複数出たとき**：iPhone と**同じ Wi-Fi** のものを選びます。ふつうは `192.168.` で始まるものです（`172.` で始まるものや `192.168.56.` は仮想のネットワークなので使いません）。分からなければ、別の PowerShell の窓で `ipconfig` と打ち、「Wireless LAN adapter Wi-Fi」の IPv4 アドレスと同じ数字のものを選びます。
2. **Windows で初めて起動したとき**は、「Windows セキュリティの重要な警告」（Node.js JavaScript Runtime）の画面が出ます。**「プライベート ネットワーク」だけにチェック**を入れ（「パブリック ネットワーク」には入れない）、「アクセスを許可する」を押します。
   - 閉じてしまった・画面が出ないとき：PowerShell で `Get-NetConnectionProfile` と打ち、`NetworkCategory` が `Public` なら、「設定 → ネットワークとインターネット → Wi-Fi →（Wi-Fi の名前）→ ネットワーク プロファイルの種類」を**プライベート**にします。
   - それでもだめなら、「Windows セキュリティ → ファイアウォールとネットワーク保護 → ファイアウォールによるアプリケーションの許可」で、Node.js JavaScript Runtime の「プライベート」にチェックを入れます。
3. **iPhone で開く**：PC と**同じ Wi-Fi** につないだ iPhone の **Safari** で、1 の「iPhone の Safari で開く URL」を開きます（ホーム画面のアプリではなく Safari で）。
   - 必ず **IP アドレスの URL**（`http://192.168.…`）で開きます。名前の URL（`http://PC名:…`）は、安全のため中継が断ります。
   - URL は長いので、PC でコピーして、自分宛てのメッセージやメモに貼り、iPhone でタップすると楽です。手で打つなら `http://` から全部打ちます（`https` ではありません）。
4. **つながったか確かめる**（どちらか）：
   - 中継を動かしている窓に、`[中継] つながりました（…）` の行が出る。
   - 別の PowerShell の窓（同じフォルダ）で `node tests/relay/ask.mjs status` と打ち、`"connected": true` と出る。

   iPhone の画面には、うまくいっても**何も出ません**。気になるときは 🐞 を押すと、パネルで警告（合言葉ちがいなど）が見えます。
5. **PC から命令を送る**（Claude Code が使います。人が打っても同じ）。**はじめて試すときは `status` と `info` だけで十分**です：

   ```powershell
   node tests/relay/ask.mjs status                     # つながっている iPhone（画面の大きさ・開いているページ）
   node tests/relay/ask.mjs info                       # 画面・safe-area・版・保存データのキーなど
   node tests/relay/ask.mjs layout selector=a.game     # ボタンの位置・大きさ・重なり・44px 未満か
   node tests/relay/ask.mjs state                      # ゲームの中の数（例：もくもくこうばの置き場の数）
   node tests/relay/ask.mjs open path=/games/seizai/   # iPhone の画面をそのゲームへ移す
   node tests/relay/ask.mjs wait after=2026-10-22T10:00:00.000Z
   node tests/relay/ask.mjs logs --since 0             # iPhone で出たエラー・ログ
   ```

   - `#` から右は説明なので、打ちません。
   - `wait after=…` は **Claude Code 用**です。`open` のあと、新しくつながるまで待ちます。`after` には、直前の `status` の `device.connectedAt` の値を入れます。
   - 引数は `名前=値` を並べます。値に `&` や空白が入るときは `"` で囲みます（例：`path="/games/hashi/?a=1&b=2"`）。
   - 保存データを書き換える `storage op=set`・`op=remove` は、`--yes` を付けたときだけ送ります（付けないと送らずに終わります。データを消さないため）。
   - 中継のポートを変えたときは `--port 番号` を付けます。終了コード：0＝うまくいった、1＝iPhone 側で失敗・使い方の誤り、2＝中継が動いていない。
6. **iPhone の自動ロック**で画面が消えると、つながりが切れます。画面を点ければ 10 秒以内につなぎ直しますが、点検の間は「設定 → 画面表示と明るさ → 自動ロック」を長め（例：5 分）にしておくと楽です。終わったら元に戻します。
7. **中継では確かめられないこと**：PC から `http` で配信しているので、Service Worker が動きません。**オフラインで開けるか・更新で新しい版になるかは、今までどおり公開版（`https://harutonatu.github.io/game-no1/`）で人が確かめます**（下の実機確認リストの 5・6）。本物の指の感触・効果音・ダブルタップ拡大・画面の写真も、人が確かめます。
8. **注意**：PC のブラウザで `127.0.0.1` を開くと Service Worker が登録され、次から古いファイルが出ることがあります。そのときは再読み込みするか、PC のブラウザでこのサイトのデータ（サイトデータ）を消します。

#### うまくいかないとき（上から順に）

1. PowerShell の窓が開いたままで、起動の表示が出ていますか（閉じていたら、0 の 3 からやり直し）。
2. iPhone は PC と**同じ Wi-Fi** ですか。ゲスト Wi-Fi や、端末どうしを通信させない設定（プライバシーセパレーターなど）では使えません。iPhone の Wi-Fi を入れ直してみてください。
3. PC のブラウザで「この PC で開く URL」（`127.0.0.1`）は開きますか。
   - 開かない → 中継の問題。窓の表示を見て、起動し直します。
   - 開くのに iPhone では開かない → IP アドレスの選び間違いか、ファイアウォール（手順 2）です。
4. 中継を起動し直すと**合言葉が変わります**。新しい URL で開き直してください。
5. iPhone に「合言葉が ちがいます」と出たら、URL の `key=` を見直します。**5 回間違えると締め切られる**ので、そのときは中継を起動し直します（Ctrl+C → もう一度 `node tests/relay/relay.mjs`）。
6. 「別の端末が つないだので 切れました」と出たら、ほかの端末が先につないでいます（つなげるのは 1 台だけ）。

#### 終わるとき

中継の PowerShell の窓をクリックして **Ctrl+C**。iPhone はしばらくつなぎ直そうとしますが、遊ぶのに支障はありません。🐞 → 「デバッグを終わる」を押すか、Safari のタブを閉じると、つなぎ直しも止まります。

この仕組みが正しく動くことは、テスト RL1〜RL12（`tests/cases/relay.mjs`）が Chromium と WebKit で確かめています。

### 公開時の実機確認リスト（iPhone 1 台＋あれば iPad。5 分程度）

1. Safari でメニューを開き、ブロック・ばいばいタイル・キリトリ道場へ入って「← メニュー」で戻れる（キリトリはプレイ中なら一時停止を経由）。
2. ブロックの盤面を素早く何度もタップ・ピンチしても画面が拡大しない（2048・キリトリの道場・メニューでも）。
3. 縦持ち・横持ちを切り替えて、ボタンがノッチ・ホームバーにかからず、スコア欄が「…」で切れない。
4. 効果音が鳴る（最初のタップから）。♪でオフにすると鳴らない。消音スイッチで鳴らない。音楽アプリの再生が止まらない。メニューのカードを押してからゲームに移るまでが遅く感じない。
5. ホーム画面に追加して起動 → 全画面・アイコン・名前が正しい。機内モードにして起動しても遊べる。
6. 更新を出した後：一度開き直すと新しい版になる（ベスト・途中経過は残っている）。
7. 小さい iPhone（「画面表示を拡大」にした iPhone でもよい）を Safari で横持ちにして、ブロックの DROP・HOLD がスコア欄・NEXT に重ならない（K1 の修正）。K2 の修正（v11）後は、電波の弱い所でもゲームが約 3 秒で開き、音が鳴る。
8. キリトリ道場：指でなぞると的が切れて軌跡が光る（指で隠れずに見える）、的が主に画面の上〜中央を飛ぶ、爆弾を切るとライフが減る（すぐには終わらない）、ひと振りで 3 つ以上切るとコンボの表示と音、II・アプリの切り替えで止まる。ProMotion（120Hz）の iPhone・iPad でも 60Hz の端末と同じ速さ。
9. キリトリ道場で、プレイ中に一時停止してメニューへ移り、戻るボタン（bfcache からの復帰）で戻ると一時停止の画面が出る。プレイ中に縦↔横を切り替えても、的が道場の中に置き直されライフが減らない（回転は V9 で確認済み。bfcache からの復帰は Playwright では再現できない）。
10. ゼンマイさんぽ：ネジを指で円を描くように回して巻ける（指が速くても数えられ、片手の親指でも回せる）。そろそろ限界で色と音が変わる。＋/－と「歩かせる」だけでも遊べる。ステージ選択に★が出て、クリアで次が開く。機内モードでも遊べ、アプリを一度閉じても★が残る。効果音のカチカチが耳障りでない。（円ドラッグのテストは CDP の合成タッチなので、実際の指での回しやすさは実機で）
11. デバッグ表示（v21〜）：Safari で `?debug=1` を付けて開くと「🐞 0」が出て、ゲームのボタンをふさがない。パネルの「コピー」を押し、メモなどに貼り付けられる。「デバッグを終わる」で消える。付けずに開いたときは何も出ない。
12. メニュー（v30〜）：メニューでゲームを開いて戻ると、そのゲームが一番上に来る（絵とベストは残る）。ホーム画面のアプリを開き直しても、最近遊んだ順のまま。PC のブラウザで Ctrl（Mac は Cmd）を押しながらカードを押して別タブで開いても、並びは変わらない（X-23。PC のブラウザだけで足りる）。
13. 小さい iPhone（「画面表示を拡大」にした iPhone でもよい）を Safari で横持ちにして、ピカッと早押しの 4 人プレイで上下の隅ボタン（1P×3P・2P×4P）が重ならない（X-17、V2 の 568×270）。
14. ピカッと早押し（v31〜）：対戦で点が入ってから「？」や結果カードの「メニューへ」を押すと、確認のカード（つづける／メニューへ もどる）が出る。「つづける」で元のカードに戻る。点がまだ無いとき・ひとりで れんしゅう・最終結果では、確かめずにメニューへ戻る。「よーい」の間に押すと「いまは おさなくて いいよ。まってね」と出てフライングにならない。「メニューへ」をすばやく2回押しても、確認のカードの「メニューへ もどる」は押されない（点が消えない）。
15. 小さい iPhone（「画面表示を拡大」にした iPhone でもよい）を Safari で横持ちにして、ブロックのスコア欄の LEVEL・LINES が「…」で切れない（X-18、V12）。スコア欄が左へ約 7px 寄るので、窮屈に見えないか（7 と一緒に見る）。
16. ハシわたり（v31〜）：茎を最大の長さまで伸ばすと、伸びる音が止まり、tap の音と光で知らせる。その tap の音が小さすぎて気づけない、ということがないか。
17. ちきゅうを守れ！ほしくだき（作り直し、v34 ごろ〜）：(a) 小さい iPhone（「画面表示を拡大」にした iPhone でもよい）の縦で、1 マス約 3.8px の小惑星の模様（てつの格子・こおりの斜め線・きんの星）と ひび が見えるか。(b) `?debug=1` で gostar 30（または遊んで星 30 ごろ）の大きな星で、かくかくしないか。(c) 前の版（v:1）の保存がある iPhone で開くと「あたらしい ほしくだきに なったよ」と遊び方が出て、かけら が残っている・メニューの「ほし N まで クリア」（ベスト）が残っている。(d) 入れ替え：4 台のあと「あたらしい ぶき（ひかえへ）」で ひかえ に入り、「いれかえ」のカードで予約すると行に「つぎから ○○」、次の星（または はね返しのあと）で砲台の武器が替わり、外した武器の Lv が残っている。
18. いろびん（v37〜）：41 面（ちいさい びん）・71 面（いろ きまりの びん）・101 面（かぎの びん）で、新しい仕掛けが初めての説明で分かるか、短い瓶の「3」の札・首の色の札・錠の絵が見分けられるか、40 面から先が難しすぎないか（IB-29）。
19. ハシわたり（v37〜）：どこまでもで落ちたあと、ぴったりを 3 回続けると ♥ が 1 つ戻る（「あと 2かいで ♥」→「♥ もどった！」）。「つぎは ボーナス」の案内が読める（HS-09）。
20. ミチビキ空港（v37〜）：何回か続けて遊んで滑走路の並びが回ごとに変わる。並びが変わった回の最初に「こんかいは かっそうろの ならびが ちがうよ」の案内が出て読める（MC-15）。
21. いろびん（v41〜）：(1) ホーム画面のアプリと Safari で、★3 か 5 面ごとの節目のクリアカードの「ともだちに おしえる」を押し、共有の画面が出るか（以下は私の推測：ホーム画面のアプリでも出るはず）。(2) LINE・メッセージに送って、文と**絵文字（とくに 🐿️ りす）が四角（□）にならないか**。(3) `https://harutonatu.github.io/game-no1/games/irobin/` とメニューの URL を LINE・メッセージに貼り、絵と題・説明が出るか（LINE は絵を覚えておくので、出ないときは時間をおいて試す）。(4) 5 面で布が出て、ヒントが分かるか。5 面のカードに予告と共有ボタンが出るか。

## 変異テスト

```sh
node tests/mutants/mutate.mjs both     # M=M10,M11 で絞り込み
```

OGP の絵（`icons/og-irobin.png`・`icons/og-menu.png`）を作り直すときだけ `node tests/og/make.mjs`（関門には入れない）。

アプリを一時フォルダにコピーし、わざと不具合を 1 つずつ入れて smoke・full を流し、検出できるかを表で出します。アプリが変わって置換前の文字列が見つからないときは「!! 置換対象なし」と出るので、`mutate.mjs` の文字列を直します。結果（`mutants/result*.json`）はコミットしません。

日付の変異 MD1〜MD8（いろコード、日付・時計の点検で追加）は smoke 3/8・full 8/8 を検出（smoke で見逃すのは画面で 0 時をまたぐ確認で、full の I14・I19 で見つける設計）。M17〜M23・MZ1〜MZ4 は日付の修正後も full で 11/11 を検出。

ゼンマイさんぽの変異（MZ1〜MZ4）は下の表の最後（番号は M17〜M23 と重ならないので振り直しなし）。master 取り込み後（v14）に M17〜M23・MZ1〜MZ4 を full で流し、11/11 を検出。

2026-10 の結果（Chromium）：smoke 12/16・full 16/16 を検出（M14〜M16 は hotfix/k2 で追加。遅い回線・版の食い違いは full だけで確かめる）。M17〜M19（キリトリ道場、feature/kiritori で追加）は smoke 2/3（M19 は爆弾が出るまで遊ぶ必要があり full のみ）・full 3/3 を検出。M20〜M23 はいろコード用に追加（feature/irocode では M17〜M20 だったが、master のキリトリ道場と番号が重なったため結合時に振り直した。I グループ＋L5 に絞って流し、full で 4/4 を検出。M22・M23 は full の I15・I13 で検出する設計）。

あまいものあつめの変異 MA1〜MA31：smoke 21/31・full 31/31 検出（2026-10-28、Chromium・PORT=9670）。最初は MA9（replay が手の t の逆順を見ない）が見逃したので、AL8 に「t が逆順の手で ok:false」を足して検出（smoke・full とも）。smoke で見逃す 10 本は full の項目（AW5〜AW24）で見つける設計。

| 変異（わざと入れた不具合） | smoke | full |
|---|---|---|
| M1 2048 で 1 手に 2 回合体する | 検出（L1） | 検出（L1） |
| M2 ブロックの pagehide でベストを保存しない | 検出（D5） | 検出（D5） |
| M3 ブロックのベストを低い得点でも上書きする | 検出（D5） | 検出（D5, D7） |
| M4 2048 の保存データで負のスコアを受け入れる | 検出（D2） | 検出（D2） |
| M5 2048 のゲームオーバー画面から「メニューへ」が消える | 検出（E2） | 検出（E2, P2） |
| M6 ブロックが safe-area 上端を空けない | 検出（V1） | v38 の関門で検出 |
| M7 事前キャッシュに存在しないファイル（install 失敗） | 検出（L5, S1, S2） | 検出（L5, S1〜S6） |
| M8 更新時に古いアプリ用キャッシュを消さない | 検出（S2） | 検出（S2） |
| M9 詰んでから結果カードまでの待ちが 0.3 秒 | 見逃し（設計どおり full のみ） | 検出（P2） |
| M10 ブロックの盤面で touchend を止めない | 検出（T5） | 検出（T5） |
| M11 common/sfx.js を事前キャッシュから外す | 検出（L5, S1, X1） | 検出（L5, S1, S3, X1） |
| M12 効果音オフの設定を読まない | 検出（D4, A4） | 検出（D4, A4） |
| M13 ブロックのスコア欄の数字を縮めない（「…」で省略） | 検出（V1） | v38 の関門で検出 |
| M14 sfx.js などをネットワーク優先・打ち切りなしに戻す（K2） | 見逃し（遅い回線は full のみ） | 検出（S4, S6） |
| M15 新しい版が出ていても古い sfx.js をキャッシュから返す | 見逃し（full のみ） | 検出（S7） |
| M16 中身の違う新しい版のファイルを旧キャッシュに混ぜる | 見逃し（full のみ） | 検出（S7） |
| M17 キリトリの切る判定が線分の端点だけ（速いスワイプで的を飛び越えると切れない） | 検出（L7） | 検出（L7） |
| M18 キリトリで的を落としてもライフが減らない（終わらない） | 検出（E6, P8） | 検出（D10, E6, P8, A6） |
| M19 キリトリで爆弾を切ってもライフが減らない | 見逃し（設計どおり full のみ ※） | 検出（P9） |
| M20 いろコード：同じ色が重なったとき blow を数え過ぎる（logic.js の score） | 検出（I1） | 検出（I1） |
| M21 いろコード：logic.js を事前キャッシュから外す | 検出（L5, I9, I8, X1） | 検出（L5, I9, I8, X1） |
| M22 いろコード：成績を 10 億で止めない（次に開くと初期化） | 見逃し（full のみ） | 検出（I15） |
| M23 いろコード：結果カードの「もう一度」の連続タップが下の色ボタンに届く | 見逃し（full のみ） | 検出（I13） |
| MD1 いろコード：todayStr を UTC の日付にする（toISOString 由来） | 検出（I2） | 検出（I2, I14, I19） |
| MD2 いろコード：todayStr の月が 1 ずれる（getMonth() + 1 を外す） | 検出（I2） | 検出（I2, I10, I14, I16, I19） |
| MD3 いろコード：隠して戻ったとき日付が変わっていても差し替えない（自動差し替えを無効） | 見逃し（full のみ） | 検出（I14, I19） |
| MD4 いろコード：確認・遊び方カードを閉じたときに日付を見直さない | 見逃し（full のみ） | 検出（I19） |
| MD5 いろコード：未来の日付の daily 記録を受け付ける | 検出（I3） | 検出（I3, I19） |
| MD6 いろコード：0時をまたいで確定した結果を、確定時の日付で記録する | 見逃し（full のみ） | 検出（I19） |
| MD7 いろコード：結果カードが0時をまたいでも「次は明日」のまま | 見逃し（full のみ） | 検出（I19。P9 も落ちたが、この変異とは無関係に見える。通常の full では P9 は合格。要観察） |
| MD8 いろコード：起動時に日付が違う途中の問題を捨てるとき負けを数えない | 見逃し（full のみ） | 検出（I19） |
| MZ1 ゼンマイの render.js を事前キャッシュから外す | 検出（ZU0, ZU4, S1, E1） | 検出（L5, ZU0, ZU4, X1） |
| MZ2 ゼンマイの保存データで範囲外の★（9など）を受け入れる | 検出（ZL6, ZU1） | 検出（ZL6, ZU1） |
| MZ3 ゼンマイの結果カードから「メニューへ」が消える | 検出（ZU1, ZU2） | 検出（ZU1, ZU2, ZU6, ZU12） |
| MZ4 ゼンマイのネジで指を持ち替えても数え直さない（位置が飛んで余分に巻く） | （未計測） | 検出（ZL7） |
| MP4 ピカッと：redoRound で回数が 1 つ進む | （未計測） | 検出（PK1。Node の項目だけで確認） |
| MP5 ピカッと：合図より前の時刻の押下でも勝ちになる | （未計測） | 検出（PK1。Node の項目だけで確認） |
| MP6 ピカッと：5回で終わらない（round >= maxRounds → round > maxRounds） | （未計測） | 検出（PK1。Node の項目だけで確認） |
| MP7 ピカッと：ひとりで れんしゅうのベストを保存しない | （未計測） | （未計測。画面の修正後に PK3・PK15 で確認） |
| MH1 ハシわたり：判定の端を開区間にする（端ちょうどで落ちる） | 検出（HL2, HL3, HL10） | 検出（HL2, HL3, HL10, HW6） |
| MH2 ハシわたり：recordBest で同点もベスト更新にする | 検出（HL7） | 検出（HL7） |
| MH3 ハシわたり：ぴったりボーナスの上限 16 を外す | 検出（HL3） | 検出（HL3, HW10） |
| MH4 ハシわたり：落ちてもいのちを減らさない | 検出（HL4, HL9, HW2, HW4） | 検出（HL4, HL9, HW2, HW4, HW5, HW8, HW10, HW11, HW15, HW19） |
| MH5 ハシわたり：隠れたとき押下を取り消さない | 見逃し（smoke では見逃す設計） | 検出（HW6） |
| MH6 ハシわたり：「もう一度」で clearLater() を呼ばない | 見逃し（smoke では見逃す設計） | 検出（HW7, HW8） |
| MH7 ハシわたり：ひとつ飛ばしの点を1つ分にする | 検出（HL9） | 検出（HL9, HW15） |
| MH8 ハシわたり：2つ先の葉に届いても渡れない | 検出（HL9, HL10, HL11, HL12, HW18） | 検出（HL9, HL10, HL11, HL12, HW18, HW9, HW15） |
| MH9 ハシわたり：ひとつ飛ばしで渡った数を1つしか数えない | 検出（HL9, HL11, HL12, HW18） | 検出（HL9, HL11, HL12, HW18, HW9, HW15） |
| MH10 ハシわたり：高さの差を無視する（斜めの距離にしない） | 検出（HL10） | 検出（HL10） |
| MH11 ハシわたり：ステージで落ちても最初（旗）に戻らない | 検出（HL11, HL12, HW16, HW18） | 検出（HL11, HL12, HW16, HW18, HW7, HW9, HW10） |
| MH12 ハシわたり：ゴールの1枚手前でクリアにする | 検出（HL11, HL12, HW16, HW18） | 検出（HL11, HL12, HW16, HW18, HW17, HW19） |
| MH13 ハシわたり：hashi.stage の 0 を通す | 検出（HL11） | 検出（HL11, HW17） |
| MH14 ハシわたり：ステージをクリアしても到達を保存しない | 検出（HW16） | 検出（HW16, HW17） |
| MH15 ハシわたり：クリアの演出中に隠れても止めない | 検出（HW16） | 検出（HW16, HW17, HW19） |
| MH16 ハシわたり：クリアの演出をタップで早送りできない | 見逃し（smoke では見逃す設計） | 検出（HW17） |
| MH17 ハシわたり：旗を無視する（落ちたら いつも最初から） | 検出（HL11, HL12, HW18） | 検出（HL11, HL12, HW18, HW19） |
| MH18 ハシわたり：ひとつ飛ばしで旗の葉を飛び越えたら旗を取らない | 検出（HL12, HW18） | 検出（HL12, HW18） |
| MH19 ハシわたり：「さいしょから」を押しても旗から再開する | 検出（HW18） | 検出（HW18） |
| MH20 ハシわたり：落ちた所の言葉を分けない | 検出（HL12） | 検出（HL12, HW19） |
| MB1 いろびん：色違いの瓶にも注げる | 検出（BL2, BL8, BL13, BW18） | 検出（BL2, BL8, BL13, BW5, BW7, BW16, BW18） |
| MB2 いろびん：注ぐ量が相手の空きを超える | 検出（BL2, BL5, BL6, BL13, BW1） | 検出（BL2, BL5, BL6, BL13, BW1） |
| MB3 いろびん：そろった瓶を注文の色と違うお客さんにも届ける | 検出（BL2, BL3, BL6, BL9, BL12） | 検出（BL2, BL3, BL6, BL9, BL12, BW16） |
| MB4 いろびん：届けた瓶が消えない（栓をしたまま残る） | 検出（BL3, BL5, BL11, BL13, BW17） | 検出（BL3, BL5, BL11, BL13, BW17） |
| MB5 いろびん：注いでも隠れた段が見えるようにならない | 検出（BL5, BL9, BL13） | 検出（BL5, BL9, BL13, BW5, BW11, BW16） |
| MB6 いろびん：ソルバーが待ち瓶をもう届けたものとして数える（手の位置がずれる） | 検出（BL6） | 検出（BL6） |
| MB7 いろびん：validateSave が手の形を確かめない | 検出（BL7） | 検出（BL7） |
| MB8 いろびん：hidden で演出を止めない | 見逃し（smoke では見逃す設計） | 検出（BW9） |
| MB9 いろびん：1手もどすで2手戻る | 見逃し（smoke では見逃す設計） | 検出（BW6, BW8） |
| MB10 いろびん：render.js を事前キャッシュから外す | 検出（BL10） | 検出（BL10, BW13） |
| MB11 いろびん：手はあるがもう解けない局面を知らせない | 見逃し（smoke では見逃す設計） | 検出（BW16） |
| MB12 いろびん：届けの連鎖を短くしない | 見逃し（smoke では見逃す設計） | 検出（BW16） |
| MB13 いろびん：届けたあと空き瓶を足す（旧仕様に戻す） | 検出（BL3, BL5, BL11, BL12, BL13, BW17） | 検出（BL3, BL5, BL11, BL12, BL13, BW17） |
| MB14 いろびん：演出中に押した瓶を押したボタンの位置で選ぶ（瓶の番号のずれ） | 検出（BW17） | 検出（BW17） |
| MB15 いろびん：布が1人早く取れる（served >= cover − 1 で取る） | 検出（BL12） | 検出（BL12） |
| MB16 いろびん：布の瓶に注げる（布を見るのは注ぐ元だけ） | 検出（BL12, BL13, BW18） | 検出（BL12, BL13, BW18） |
| MB17 いろびん：古い v:2 の手をそのまま再生する（布の前のルールの手を捨てない） | 検出（BL7, BL14） | 検出（BL7, BL14） |
| MB19 いろびん：布の瓶を押すと選べる | 検出（BW18） | 検出（BW18） |
| MB20 いろびん：届けた瓶の跡を残さず詰める | 検出（BW17） | 検出（BW17） |
| MB21 いろびん：布の札の残りを 0 のまま表示する | 検出（BW18） | 検出（BW18） |
| MQ1 まとめてポン：斜めもつながったかたまりにする | 検出（QL2, QL11, QW1, QW17） | 検出（QL2, QL11, QW1, QW4, QW5, QW7, QW9, QW10, QW11, QW13, QW17, QW19, QW18） |
| MQ2 まとめてポン：1個でも消せる（canRemove と applyRemove の両方） | 検出（QL2, QL7） | 検出（QL2, QL7） |
| MQ3 まとめてポン：点数を (n−1)² にする | 検出（QL3, QL11, QW1） | 検出（QL3, QL11, QL9, QW1, QW4, QW9, QW19） |
| MQ4 まとめてポン：全部消しの +1000 がない | 検出（QL3） | 検出（QL3, QL9, QW4） |
| MQ5 まとめてポン：空いた列を左へ詰めない | 検出（QL4, QW17） | 検出（QL4, QL9, QW4, QW5, QW7, QW10, QW11, QW17, QW19） |
| MQ6 まとめてポン：終わりの判定が逆（消せるのに終わる・消せないのに続く） | 検出（QL5, QL7, QL11, QW1, QW2, QW3, QW17） | 検出（QL5, QL7, QL11, QL9, QW1, QW2, QW3, QW4, QW5, QW6, QW7, QW8, QW9, QW10, QW11, QW13, QW14, QW17, QW19） |
| MQ7 まとめてポン：validateSave が保存の v を見ない | 検出（QL7） | 検出（QL7） |
| MQ8 まとめてポン：2回目を待たずに1回のタップで消す | 検出（QW1, QW2, QW3, QW17） | 検出（QW1, QW2, QW3, QW4, QW5, QW7, QW8, QW9, QW10, QW11, QW13, QW17, QW19, QW18） |
| MQ9 まとめてポン：消したあと上のマスが落ちない（すきまが残る） | 検出（QL4, QL11, QW1, QW17） | 検出（QL4, QL11, QL9, QW1, QW4, QW5, QW7, QW9, QW10, QW11, QW13, QW17, QW19, QW18） |
| MQ10 まとめてポン：終わりのカードが出た直後も押せる（0.6 秒のロックなし） | 見逃し（smoke では見逃す設計） | 検出（QW4） |
| MQ11 まとめてポン：1手もどすで局面が戻らない（手の記録だけ減る） | 見逃し（smoke では見逃す設計） | 検出（QW6, QW9, QW19） |
| MQ12 まとめてポン：render.js を事前キャッシュから外す（オフラインで開かない） | 検出（QW16） | 検出（QW16, QW12） |
| MQ13 まとめてポン：recordBest が低い点でもベストを上書きする | 検出（QL7） | 検出（QL7, QW5） |
| MQ14 まとめてポン：カードを閉じた直後の押下が盤に届く | 見逃し（smoke では見逃す設計） | 検出（QW13） |
| MQ15 まとめてポン：開いたとき保存から再開しない | 検出（QW2） | 検出（QW2, QW4, QW19） |
| MQ16 まとめてポン：むずかしいのベストも ふつうのキーに書く | 検出（QW17） | 検出（QW5, QW17） |
| MQ17 まとめてポン：メニューのベストが壊れた値（負・小数）も表示する | 見逃し（smoke では見逃す設計） | 検出（QW15） |
| MQ18 まとめてポン：消える音 pop に消した数を渡さない（いつも同じ高さ） | 見逃し（smoke では見逃す設計） | 検出（QW11） |
| MQ19 まとめてポン：やさしいの色の数が 4（3色にならない） | 検出（QL1, QL6, QW17） | 検出（QL1, QL6, QW5, QW17） |
| MQ20 まとめてポン：最後のモードを覚えない（開き直すと ふつう） | 検出（QW17） | 検出（QW17） |
| MQ21 まとめてポン：いちばん少ない のこりを書かない | 検出（QW17） | 検出（QW5, QW17） |
| MQ22 まとめてポン：2回目のずれの許容（半マス）がない | 見逃し（smoke では見逃す設計） | 検出（QW18） |
| MQ23 まとめてポン：validateLeast が壊れた値（負・小数・200 超）を通す | 検出（QL10） | 検出（QL10） |
| MQ24 まとめてポン：最後の手でベストの数字がポンの前に変わる | 見逃し（smoke では見逃す設計） | 検出（QW4） |
| MQ25 まとめてポン：選んだふちの明滅が止まらない（rAF が回り続ける） | 見逃し（smoke では見逃す設計） | 検出（QW18） |
| MQ26 まとめてポン：「おしい」の線がモード別でない（どれも 10） | 検出（QL1, QL10） | 検出（QL1, QL10, QW5） |
| MQ27 まとめてポン：のこり 5 こ以下でも小さなお祝いをしない | 検出（QW17） | 検出（QW17） |
| MQ28 まとめてポン：fx が空でも毎コマ全画面を消し直す | 見逃し（smoke では見逃す設計） | 検出（QW18） |
| MQ29 まとめてポン：まわりも消えるのが 6こ以上から（BIG が 6） | 検出（QL11, QW3, QW17） | 検出（QL11, QL9, QW3, QW4, QW5, QW10, QW11, QW17, QW19） |
| MQ30 まとめてポン：まわりに斜めも入れる（ひし形でなく四角） | 検出（QL11, QW1, QW17） | 検出（QL11, QL9, QW1, QW4, QW5, QW7, QW9, QW10, QW11, QW13, QW17, QW19, QW18） |
| MQ31 まとめてポン：4こ以下を消しても れんぞくが 0 に戻らない | 検出（QL11） | 検出（QL11, QL9, QW5, QW11, QW19） |
| MQ32 まとめてポン：3回目でも範囲が広がらない（いつも r=1） | 検出（QL11, QW17） | 検出（QL11, QL9, QW4, QW5, QW7, QW10, QW11, QW17, QW19） |
| MQ33 まとめてポン：まわりで消えたマスの点を足さない | 検出（QL11, QW1） | 検出（QL11, QL9, QW1, QW4, QW9, QW19） |
| MQ34 まとめてポン：1手もどしても れんぞくが戻らない | 見逃し（smoke では見逃す設計） | 検出（QW19） |
| MQ35 まとめてポン：前の版（v:2）の途中保存の手を捨てない（v:1 だけ捨てる） | 検出（QL7, QW2） | 検出（QL7, QW2） |
| MQ36 まとめてポン：選んだとき まわりの予告（光・札の合計）が出ない | 検出（QW1） | 検出（QW1, QW19） |
| MQ37 まとめてポン：「れんぞく 2」「ひろがる！」の大きな文字が出ない | 見逃し（smoke では見逃す設計） | 検出（QW19） |
| MQ38 まとめてポン：まわりも消える演出が 0.9 秒を超える | 見逃し（smoke では見逃す設計） | 検出（QW19） |
| MQ39 まとめてポン：まわりも消えるときの音 blast が鳴らない | 見逃し（smoke では見逃す設計） | 検出（QW11） |
| MQ40 まとめてポン：盤の上の れんぞくの表示が出ない | 見逃し（smoke では見逃す設計） | 検出（QW19） |
| MF1 ミチビキ空港：色が違う滑走路にも着陸する | 検出（FL3） | 検出（FL3） |
| MF2 ミチビキ空港：ぶつかってもライフが減らない | 検出（FL4, FW2, FW4, FW21） | 検出（FL4, FL10, FW2, FW4, FW10, FW12, FW21, FW22） |
| MF3 ミチビキ空港：ぶつかると片方だけ消える | 検出（FL4, FL9） | 検出（FL4, FL9） |
| MF4 ミチビキ空港：端で跳ね返らず外へ出る | 検出（FL5, FL9） | 検出（FL5, FL9, FL10） |
| MF5 ミチビキ空港：道が終わると止まる（直進しない） | 検出（FL2） | 検出（FL2, FW9） |
| MF6 ミチビキ空港：最初から2色（COLOR_STEPS [0, 0, 12]） | 検出（FL1, FL3, FL6, FL12） | 検出（FL1, FL3, FL6, FL12, FW11, FW13, FW19） |
| MF7 ミチビキ空港：出る間隔が短くならない（§19 C1 の式ごと） | 検出（FL1, FL6） | 検出（FL1, FL6, FL10） |
| MF8 ミチビキ空港：ライフ 0 で終わらない | 検出（FL4, FW2, FW4, FW21） | 検出（FL4, FL10, FW2, FW4, FW10, FW21, FW22） |
| MF9 ミチビキ空港：着陸の動き中もぶつかる | 検出（FL3, FL9） | 検出（FL3, FL9） |
| MF10 ミチビキ空港：予告なしにすぐ出る | 検出（FL7） | 検出（FL7, FW11, FW12） |
| MF11 ミチビキ空港：乱数に Math.random を使う（種を見ない） | 検出（FL7） | 検出（FL7） |
| MF12 ミチビキ空港：NEAR_D を CRASH_D と同じに（知らせが出ない） | 検出（FL1, FL4） | 検出（FL1, FL4, FW10） |
| MF13 ミチビキ空港：setPath が点を場の内側に収めない | 検出（FL5） | 検出（FL5） |
| MF14 ミチビキ空港：pickPlane の半径を PLANE_R に（つかみにくい） | 検出（FL2, FW1, FW20） | 検出（FL2, FW1, FW20） |
| MF15 ミチビキ空港：hidden で止まらない | 検出（FW5） | 検出（FW5） |
| MF16 ミチビキ空港：validateBest が負の値を通す | 検出（FL8, FW3） | 検出（FL8, FW3） |
| MF17 ミチビキ空港：終わりのカードのロックなし | 検出（FW2） | 検出（FW2） |
| MF18 ミチビキ空港：向きを見ない（区域に入れば着陸） | 検出（FL3, FW1, FW2） | 検出（FL3, FL10, FW1, FW2, FW19） |
| MF19 ミチビキ空港：内積の符号が逆（逆向きのときだけ着陸） | 検出（FL3, FL6, FL12, FW1, FW2, FW21） | 検出（FL3, FL6, FL10, FL12, FW1, FW2, FW9 ほか） |
| MF20 ミチビキ空港：LAND_DOT の比べ方を >= から > に | 検出（FL3） | 検出（FL3） |
| MF21 ミチビキ空港：LAND_DOT を 0 に（真横まで着陸する） | 検出（FL1, FL3, FW2） | 検出（FL1, FL3, FW2） |
| MF22 ミチビキ空港：wrongway を区域にいる間ずっと出す | 検出（FL3） | 検出（FL3） |
| MF23 ミチビキ空港：suggestPath が手前の点を通らず、入り口へ一直線 | 検出（FL12） | 検出（FL12, FW9） |
| MF24 ミチビキ空港：setPath の guided が向きを見ない | 検出（FL3, FW1） | 検出（FL3, FW1） |
| MF25 ミチビキ空港：着陸してもすぐベストを保存しない（§19 A2） | 検出（FW21） | 検出（FW19, FW21） |
| MF26 ミチビキ空港：最初の setPath で機体のそばの点を捨てない（§19 A1） | 検出（FW20） | 検出（FW20） |
| MF27 ミチビキ空港：pageshow で終わりのカードを出し直さない（§19 A3） | 見逃し（smoke では見逃す設計） | 検出（FW22） |
| MF28 ミチビキ空港：同じ機体を2本目の指でもなぞれる（§19 A7） | 見逃し（smoke では見逃す設計） | 検出（FW23） |
| MF29 ミチビキ空港：「さいしょから」が確認なしで始め直す（§19 B2） | 検出（FW21） | 検出（FW7, FW21） |
| MB22 いろびん：pageshow でクリアのカードの押せない見た目を外さない（§19 A3 の横展開） | 見逃し（smoke では見逃す設計） | 検出（BW19） |
| MQ41 まとめてポン：pageshow で終わりのカードの押せない見た目を外さない（§19 A3 の横展開） | 見逃し（smoke では見逃す設計） | 検出（QW20） |
| MW1 もくもくこうば：閉じた間の上限を外す（awaySeconds も catchUp も 7200 を見ない） | 検出（WL7, WW3） | 検出（WL7, WW3） |
| MW2 もくもくこうば：半分の係数を見ない（閉じた秒をそのまま進める） | 検出（WL2, WL7, WW3, WW4） | 検出（WL2, WL7, WW3, WW4） |
| MW3 もくもくこうば：半分の係数を2回掛ける（main.js でも掛ける＝4分の1） | 検出（WW3, WW4） | 検出（WW3, WW4） |
| MW4 もくもくこうば：上限を半分にした後で掛ける（min(sec × 0.5, 7200)＝実質4時間） | 検出（WL7） | 検出（WL7） |
| MW5 もくもくこうば：時計が戻ったとき now − savedAt をそのまま使う（マイナス） | 検出（WL7） | 検出（WL7） |
| MW6 もくもくこうば：壊れた savedAt を 0 にしない（awaySeconds が数かを見ない） | 検出（WL7） | 検出（WL7） |
| MW7 もくもくこうば：loadSave が壊れた savedAt を 0（1970年）にする（NaN にしない＝2時間ぶん足される） | 検出（WL8, WW3） | 検出（WL8, WW3） |
| MW8 もくもくこうば：ローカルの日付で経った時間を数える（日付の差×86400） | 検出（WL7, WW3, WW4） | 検出（WL7, WW3, WW4） |
| MW9 もくもくこうば：visible で二重に足す（sleeping を見ずに毎回足す） | 検出（WW4） | 検出（WW4） |
| MW10 もくもくこうば：人の費用の増え方 1.55 を 1.05 に | 検出（WL1） | 検出（WL1） |
| MW11 もくもくこうば：マネージャーの「はやい」が効かない | 検出（WL2） | 検出（WL2, WL11） |
| MW12 もくもくこうば：マネージャーの「もうかる」が効かない | 検出（WL1） | 検出（WL1, WL11） |
| MW13 もくもくこうば：置き場の上限を見ない（つまらない） | 検出（WL2, WL8, WL10） | 検出（WL2, WL8, WL10） |
| MW14 もくもくこうば：自然に生えない（木が尽きて止まる） | 検出（WL2） | 検出（WL2, WL11） |
| MW15 もくもくこうば：目標を前の段から数え続ける（広げても 0 に戻さない） | 検出（WL4） | 検出（WL4） |
| MW16 もくもくこうば：応援の使えない間を見ない（連打できる） | 検出（WL3） | 検出（WL3, WL11） |
| MW17 もくもくこうば：注文のお礼を2回払う | 検出（WL6） | 検出（WL6, WL11, WW7） |
| MW18 もくもくこうば：loadSave が v を見ない（新しい版の保存も読む） | 検出（WL8, WW5） | 検出（WL8, WW5） |
| MW19 もくもくこうば：loadSave がお金を丸めない（負・上限超え・小数のまま） | 検出（WL8） | 検出（WL8） |
| MW20 もくもくこうば：壊れた保存を bak に写さず上書き | 検出（WW5） | 検出（WW5） |
| MW21 もくもくこうば：bak が既にあっても上書き（最初の壊れた保存が消える） | 検出（WW5） | 検出（WW5） |
| MW22 もくもくこうば：MONEY_MAX で止めない | 検出（WL10） | 検出（WL10） |
| MW23 もくもくこうば：船の大きさが増えない（SHIP_GROWTH を見ない＝いつも 30,000） | 検出（WL5） | 検出（WL5, WL11, WW8） |
| MW24 もくもくこうば：船の大きさの上限を見ない（n が大きいと Infinity・NaN） | 検出（WL5） | 検出（WL5, WW8） |
| MW25 もくもくこうば：船が届くと ships を 2 増やす | 検出（WL5, WW6） | 検出（WL5, WL11, WW6, WW8） |
| MW26 もくもくこうば：船のお礼を2回払う | 検出（WL5） | 検出（WL5, WW8） |
| MW27 もくもくこうば：船が届いたとき あまりを捨てる（got = 0） | 検出（WL5） | 検出（WL5） |
| MW28 もくもくこうば：2せき目からもエンディングのカードを出す | 見逃し（smoke では見逃す設計） | 検出（WW8） |
| MW29 もくもくこうば：大口の注文へ入った板も船に数える | 検出（WL5） | 検出（WL5, WL11） |
| MW30 もくもくこうば：logic.js を APP_FILES から外す | 見逃し（smoke では見逃す設計） | 検出（WW16） |
| MW31 もくもくこうば：actors.js を APP_FILES から外す | 見逃し（smoke では見逃す設計） | 検出（WW16） |
| MW32 もくもくこうば：カードの 400ms のロックなし（出た直後に押せる） | 検出（WW2） | 検出（WW2, WW7） |
| MW33 もくもくこうば：hidden で止まらない（visibilitychange の hidden で sleep を呼ばない） | 検出（WW4） | 検出（WW4, WW11） |
| MW34 もくもくこうば：pagehide でタイマーを片付けない | 見逃し（smoke では見逃す設計） | 検出（WW11） |
| MW35 もくもくこうば：10 秒ごとの自動保存をしない | 検出（WW5） | 検出（WW5） |
| MW36 もくもくこうば：シートの値段が costOf と 1 割ずれる（表示の1ずれ） | 検出（WW1） | 検出（WW1） |
| MW37 もくもくこうば：#money が 1 えんずれる（表示の1ずれ） | 検出（WW1） | 検出（WW1, WW8） |
| MW38 もくもくこうば：広げても seizai.best を書かない | 検出（WW2） | 検出（WW2） |
| MW39 もくもくこうば：お金が足りないとき音 deny もヒントも出さない | 検出（WW1） | 検出（WW1, WW14） |
| MW40 もくもくこうば：上限に着いても切る前の秒を渡さない（SZ-01 の戻り） | 検出（WW3） | 検出（WW3） |
| MW41 もくもくこうば：遊び方の間も止めない（v31 で置換元を今の `readingCard()` に合わせた。T-15） | 見逃し（smoke では見逃す設計） | 検出（WW18） |
| MW42 もくもくこうば：rAF だけが止まった間を足さない（捨てる。v31 で置換元を合わせた。T-15） | 見逃し（smoke では見逃す設計） | 検出（WW18） |
| MW43 もくもくこうば：シートを開いても押した部署を見える所へスクロールしない | 見逃し（smoke では見逃す設計） | 検出（WW18） |
| MW44 もくもくこうば：新しい版の保存を seizai.save.v<n> に残さない | 検出（WW5） | 検出（WW5, WW18） |
| MW45 もくもくこうば：大口の注文が こうじょう から | 検出（WL6, WL8） | 検出（WL6, WL8, WW7, WW18） |
| MW46 もくもくこうば：とくべつな注文のお礼が ふつうと同じ | 検出（WL6, WL8） | 検出（WL6, WL8, WL11） |
| MW47 もくもくこうば：壊れた保存の注文のお礼を計算し直さない | 検出（WL8） | 検出（WL8） |
| MW48 もくもくこうば：fastForward が 2 倍の速さで進む | 検出（WL9） | 検出（WL9, WW18） |
| MW49 もくもくこうば：とくべつな注文の旗が保存で消える | 検出（WL8） | 検出（WL8, WW7） |
| MW50 もくもくこうば：とくべつな注文が出ない | 検出（WL6） | 検出（WL6, WL11） |
| MW61 もくもくこうば：さいしょから で seizai.save.bak を消さない | 見逃し（smoke では見逃す設計） | 検出（WW25） |
| MW62 もくもくこうば：さいしょから で保存を止めずに消す（pagehide で古い状態を書き戻す） | 見逃し（smoke では見逃す設計） | 検出（WW25） |
| MW63 もくもくこうば：さいしょから で seizai.best も消す | 見逃し（smoke では見逃す設計） | 検出（WW25） |
| MW64 もくもくこうば：さいしょからの「やめる」でも保存を消す | 見逃し（smoke では見逃す設計） | 検出（WW25） |
| MK1 ほしくだき：2択の間も場が進む（choose でも step が進み、fly に戻る） | —（作り直しでは full だけ流した） | 検出（KL7, KL12） |
| MK2 ほしくだき：とどいたら かけら・武器を消す | —（作り直しでは full だけ流した） | 検出（KL5, KL11, KL19, KW3, KW23） |
| MK3 ほしくだき：とどいたとき星を最初からにしない（残りのまま続く） | —（作り直しでは full だけ流した） | 検出（KL5, KL11, KL12, KL13, KL14, KW3） |
| MK4 ほしくだき：エンディングを2回出す（星 ENDING_STAR より先のクリアでも出す） | —（作り直しでは full だけ流した） | 検出（KL6, KW5） |
| MK5 ほしくだき：場を押すと進む（#field のクリックで step を進める。#fieldCanvas は pointer-events: none なので親の #field に付ける） | —（作り直しでは full だけ流した） | 検出（KW4, KW22, KW17） |
| MK6 ほしくだき：壊れた保存を bak に写さず上書き | —（作り直しでは full だけ流した） | 検出（KW6） |
| MK7 ほしくだき：bak が既にあっても上書き（最初の壊れた保存が消える） | —（作り直しでは full だけ流した） | 検出（KW6, KW24） |
| MK8 ほしくだき：hidden でも進む（visibilitychange の hidden で sleep を呼ばない） | —（作り直しでは full だけ流した） | 検出（KW11） |
| MK9 ほしくだき：logic.js を APP_FILES から外す | —（作り直しでは full だけ流した） | 検出（KW16） |
| MK10 ほしくだき：render.js を APP_FILES から外す | —（作り直しでは full だけ流した） | 検出（KW16） |
| MK11 ほしくだき：2択のカードの 400ms のロックなし（出た直後に押せる） | —（作り直しでは full だけ流した） | 検出（KW2, KW5, KW12, KW21, KW23） |
| MK12 ほしくだき：#kakera が 1 ずれる（表示の1ずれ） | —（作り直しでは full だけ流した） | 検出（KW1） |
| MK13 ほしくだき：行の値段が upCostOf と 1 割ずれる（表示の1ずれ） | —（作り直しでは full だけ流した） | 検出（KW1） |
| MK14 ほしくだき：#starBar がこわした割合とずれる | —（作り直しでは full だけ流した） | 検出（KW1） |
| MK15 ほしくだき：はね返しの「あと N%」をこわした割合で出す | —（作り直しでは full だけ流した） | 検出（KW3） |
| MK16 ほしくだき：クリアしても asteroid.best を書かない | —（作り直しでは full だけ流した） | 検出（KW5） |
| MK17 ほしくだき：かけらが足りないとき音 deny もヒントも出さない | —（作り直しでは full だけ流した） | 検出（KW1, KW11, KW14） |
| MK18 ほしくだき：開き直すと かけらが 0 になる（保存を読んでも かけらを捨てる） | —（作り直しでは full だけ流した） | 検出（KW6, KW24） |
| MK19 ほしくだき：pagehide でタイマーを片付けない | —（作り直しでは full だけ流した） | 検出（KW11） |
| MK20 ほしくだき：カード（遊び方・2択・入れ替え・エンディング・さいしょから）が出ている間も止めない（running から overlay === null を外す。T-15・§21.4） | —（作り直しでは full だけ流した） | 検出（KW11, KW21, KW23） |
| MK21 ほしくだき：動きを減らす設定を見ない | —（作り直しでは full だけ流した） | 検出（KW13） |
| MK22 ほしくだき：2択が開き直しで変わる（保存の offer を入れ替えて読む） | —（作り直しでは full だけ流した） | 検出（KL7, KL9, KW2） |
| MK23 ほしくだき：区切りをやり直し（はね返し）でもらい直せる | —（作り直しでは full だけ流した） | 検出（KL13, KW18） |
| MK24 ほしくだき：星のベスト時間を遅いほうにする | —（作り直しでは full だけ流した） | 検出（KL14, KW19） |
| MK25 ほしくだき：もろい底なし（下の行も体力 1 倍） | —（作り直しでは full だけ流した） | 検出（KL1, KL11, KL15, KL19） |
| MK26 ほしくだき：相性の倍率 aff がいつも 1 | —（作り直しでは full だけ流した） | 検出（KL1, KL3, KL15, KL19） |
| MK27 ほしくだき：星の途中の保存（mid）を捨てる | —（作り直しでは full だけ流した） | 検出（KL9, KL11, KL13, KL14, KW6） |
| MK28 ほしくだき：区切りの帯 #msBanner を出さない | —（作り直しでは full だけ流した） | 検出（KW18） |
| MK29 ほしくだき：開き直しで いまの挑戦の始め（tryAt）をずらさない（クリアの時間に遊んだ合計の秒が足される） | —（作り直しでは full だけ流した） | 検出（KW5, KW6） |
| MK30 ほしくだき：◎ を星の札に関係なく得意のある武器ぜんぶに付ける | —（作り直しでは full だけ流した） | 検出（KW20） |
| MK31 ほしくだき：クリアの帯の「ちきゅうまで あと N%」を近さの逆で出す | —（作り直しでは full だけ流した） | 検出（KW19） |
| MK32 ほしくだき：買った行に「＋N%」を出さない | —（作り直しでは full だけ流した） | 検出（KL19, KW1） |
| MK33 ほしくだき：買えない間の「あと N」を不足分でなく値段で出す | —（作り直しでは full だけ流した） | 検出（KW1） |
| MK34 ほしくだき：はね返しのおすすめをいつも 1 行目にする（いちばん安い行を見ない） | —（作り直しでは full だけ流した） | 検出（KW3） |
| MK35 ほしくだき：2択の冒頭の案内 #choiceLead を出さない | —（作り直しでは full だけ流した） | 検出（KW20） |
| MK36 ほしくだき：クリアの演出中の保存を同じ星にする（開き直すと同じ星をもう一度） | —（作り直しでは full だけ流した） | 検出（KL9, KL13, KL14, KW6） |
| MK37 ほしくだき：壊れた bestT（キーが整数でない・0 以下・大きすぎ）を捨てない | —（作り直しでは full だけ流した） | 検出（KL14, KW19） |
| MK38 ほしくだき：さいしょからで asteroid.save.bak を消さない | —（作り直しでは full だけ流した） | 検出（KW21） |
| MK39 ほしくだき：さいしょからのあと保存を止めない（pagehide・hidden でメモリ上の古い状態を書き戻す） | —（作り直しでは full だけ流した） | 検出（KW21, KW25） |
| MK40 ほしくだき：さいしょからで asteroid.best も消す | —（作り直しでは full だけ流した） | 検出（KL19, KW21） |
| MK41 ほしくだき：さいしょからの確認で「やめる」を押しても消す | —（作り直しでは full だけ流した） | 検出（KW21） |
| MK42 ほしくだき：さいしょからで消せないとき #hint で知らせない（古い保存が残ったのに気づけない） | —（作り直しでは full だけ流した） | 検出（KW21） |
| MK43 ほしくだき：砲台の x がねらうマスへ動く（AS-01 の戻り） | —（作り直しでは full だけ流した） | 検出（KL3, KL11, KL12, KL13, KL16, KL18, KW22） |
| MK44 ほしくだき：弾がいつも真上へ飛ぶ（たま・ほのお・どかん以外の砲身の向き ang を見ない） | —（作り直しでは full だけ流した） | 検出（KL3, KL5, KL6, KL9, KL11, KL13, KL14, KL17, KL19, KW5, KW7, KW22） |
| MK45 ほしくだき：ビームが最初のマスで止まる（奥へ掘らない） | —（作り直しでは full だけ流した） | 検出（KL3, KL11, KL19） |
| MK46 ほしくだき：いなずまが違う種類のマスへ伝わらない（v40 の前に戻る。v40 で意味が逆になったので書き直した） | smoke は v40 で流していない | 検出（KL3, KL20, KW26。v40 の関門 2026-10-25） |
| MK47 ほしくだき：いなずまが BOLT_CELLS（しんかの数）を見ない（v40 で置換元を新しい boltTree の while の行に直した） | smoke は v40 で流していない | 検出（KL3, KL11, KL20, KL23。v40 の関門 2026-10-25） |
| MK48 ほしくだき：てつ を すじ で入れる（かたまりにしない） | —（作り直しでは full だけ流した） | 検出（KL2, KL11, KW21） |
| MK49 ほしくだき：入れ替えが星の途中ですぐ当たる | —（作り直しでは full だけ流した） | 検出（KL5, KL6, KL9, KL10, KL11, KL12, KL17, KW23） |
| MK50 ほしくだき：はね返しのやり直しで入れ替えが当たらない | —（作り直しでは full だけ流した） | 検出（KL5, KW23） |
| MK51 ほしくだき：入れ替えで外した武器の Lv を忘れる（ひかえで Lv 1 になる） | —（作り直しでは full だけ流した） | 検出（KL5, KL6, KL9, KL17, KW23） |
| MK52 ほしくだき：入れ替えで載せた武器が外した武器の Lv を引き継ぐ（Lv が武器ごとでない） | —（作り直しでは full だけ流した） | 検出（KL5, KL6, KL9, KL17, KW23） |
| MK53 ほしくだき：持ったことが無い武器を入れ替えで選べる | —（作り直しでは full だけ流した） | 検出（KL17, KW23） |
| MK54 ほしくだき：4 台のあと「あたらしい ぶき」を出さない（ひかえへ入れられない） | —（作り直しでは full だけ流した） | 検出（KL1, KL7, KL10, KL11, KL12, KW8, KW12, KW23） |
| MK55 ほしくだき：6 種類そろっても #unlockBtn を出す | —（作り直しでは full だけ流した） | 検出（KW8, KW23） |
| MK56 ほしくだき：ひかえの武器も強くできる（upgrade の枠の番号が砲台の数をこえたら ひかえ の Lv を上げる） | —（作り直しでは full だけ流した） | 検出（KL17） |
| MK57 ほしくだき：v:1 から星・武器も引き継ぐ（v:2 と同じに読む） | —（作り直しでは full だけ流した） | 検出（KL9, KW24） |
| MK58 ほしくだき：v:1 で かけらを 0 にする | —（作り直しでは full だけ流した） | 検出（KL9, KW24） |
| MK59 ほしくだき：v:1 のとき元の保存を asteroid.save.bak に写さない | —（作り直しでは full だけ流した） | 検出（KW24） |
| MK60 ほしくだき：v:1 のとき asteroid.best を消す | —（作り直しでは full だけ流した） | 検出（KW24） |
| MK61 ほしくだき：デバッグの lose で hold にしない（撃ちきって clear になりうる。T-19） | —（作り直しでは full だけ流した） | 検出（KW3） |
| MK62 ほしくだき：表に戻ったとき保存がほかで変わっていても開き直さない（X-20） | —（作り直しでは full だけ流した） | 検出（KW25, X1） |
| MK63 ほしくだき：saveNow が stale を見ない（writeKey で止まるが「ほぞんが できないよ」が出る。X-20） | —（作り直しでは full だけ流した） | 検出（KW25）※ KW25 を直したあとに流し直し |
| MK64 ほしくだき：裏へ回る・閉じるときの保存で比べ直さない（staleOnHide。storage イベントが届く前に古い状態を書き戻す。X-20） | —（作り直しでは full だけ流した） | 検出（KW25）※ KW25 を直したあとに流し直し |
| MK65 ほしくだき：裏で別のタブが書いても保存を止めない（storage を見ない。X-20） | —（作り直しでは full だけ流した） | 検出（KW25） |
| MK66 ほしくだき：2択の候補に ひかえの武器が出る | —（作り直しでは full だけ流した） | 検出（KL7, KL9, KL17, KW23） |
| MK67 ほしくだき：4 台のあとの2択で「えらんだ ぶきは ひかえ（いま つかわない ぶき）に はいるよ」を出さない | —（作り直しでは full だけ流した） | 検出（KW23） |
| MK68 ほしくだき：残りの武器が 1 つでも #choiceB を隠さない | —（作り直しでは full だけ流した） | 検出（KW23） |
| MK69 ほしくだき：ひかえが空でも #swapCard を開く | —（作り直しでは full だけ流した） | 検出（KW23） |
| MK70 ほしくだき：予約の札「つぎから ○○」を出さない | —（作り直しでは full だけ流した） | 検出（KW8, KW23） |
| MK71 ほしくだき：入れ替えの予約を保存しない（開き直すと予約が消える） | —（作り直しでは full だけ流した） | 検出（KL9, KL17, KW23） |
| MK72 ほしくだき：クリアの演出中の保存で予約を当てない（開き直すと予約が消える） | —（作り直しでは full だけ流した） | 検出（KL9, KL17） |
| MK73 ほしくだき：はね返しの間の保存で予約を当てない（開き直すとやり直しに予約が当たらない。T1） | —（full だけ流した） | 検出（KL17） |
| MK74 ほしくだき：2択の間の保存で戻り先（bounce・clear）を見ない（T1） | —（full だけ流した） | 検出（KL17） |
| MK75 ほしくだき：いなずまの威力が伝わっても減らない（v40） | smoke は v40 で流していない | 検出（KL3, KL11, KL20, KL23。v40 の関門 2026-10-25） |
| MK76 ほしくだき：たまの撃つ間隔が Lv で短くならない（v40） | smoke は v40 で流していない | 検出（KL21, KL23。v40 の関門 2026-10-25） |
| MK77 ほしくだき：たまが貫通しない（v40） | smoke は v40 で流していない | 検出（KL21, KL23。v40 の関門 2026-10-25） |
| MK78 ほしくだき：たまが通りぬけても威力が減らない（v40） | smoke は v40 で流していない | 検出（KL21, KL23。v40 の関門 2026-10-25） |
| MK79 ほしくだき：どかんの円の中心を内側へずらさない（v40） | smoke は v40 で流していない | 検出（KL3, KL22, KL23。v40 の関門 2026-10-25） |
| MK80 ほしくだき：たまの強さが Lv 11 から伸びない（v40） | smoke は v40 で流していない | 検出（KL1, KL21, KL23。v40 の関門 2026-10-25） |
| MK81 ほしくだき：たまが こわしたマスだけ通りぬける（硬いマスで止まる。ユーザーの答え「こわさなくても進む」の逆。v40） | smoke は v40 で流していない | 検出（KL21, KL23。v40 の関門 2026-10-25） |
| MK82 ほしくだき：通りぬけて星の上へ出た たまを消さない（v40 レビュー） | smoke は v40 で流していない | 検出（KL21。v40 の関門 2026-10-25） |
| MK83 ほしくだき：たまの しんか で「つきぬける ように なった」を出さない（v40 レビュー。render.js） | smoke は v40 で流していない | 検出（KW26。v40 の関門 2026-10-25） |
| MA1 あまいものあつめ：ふちでない角砂糖も運ぶ（見つける：AL3・AL4） | 検出（AL3, AL4, AL7, AW4） | 検出（AL3, AL4, AL7, AW4, AW5, AW7） |
| MA2 あまいものあつめ：ななめもふちに数える（見つける：AL3） | 検出（AL3, AW4） | 検出（AL3, AW4, AW5, AW7） |
| MA3 あまいものあつめ：ちがう色の角砂糖も運ぶ（見つける：AL4） | 検出（AL3, AL4, AL6, AL7, AL10, AW1, AW2, AW3, AW4, X1） | 検出（AL3, AL4, AL6, AL7, AL10, AL12, AL11, AW1, AW2, AW3, AW4, AW5, AW6, AW7, AW11, AW12, AW13, AW14, AW17, AW21, AW22, AW23, X1） |
| MA4 あまいものあつめ：数が 0 になっても箱がわくに残る（見つける：AL4・AW1） | 検出（AL4, AL6, AL8, AL13, AW3） | 検出（AL4, AL6, AL8, AL12, AL13, AL11, AW3, AW7, AW11, AW12, AW19, AW20） |
| MA5 あまいものあつめ：押した箱が列に残る（見つける：AL5・AW1） | 検出（AL5, AL6, AL8, AL10, AL13, AW1, AW2, AW3, AW4, X1） | 検出（AL5, AL6, AL8, AL10, AL12, AL13, AL11, AW1, AW2, AW3, AW4, AW5, AW6, AW7, AW8, AW9, AW10, AW11, AW12, AW13, AW14, AW17, AW19, AW20, AW21, AW22, AW23, X1） |
| MA6 あまいものあつめ：わくがいっぱいでも押せる（見つける：AL5・AL7） | 検出（AL5, AL7, AL8, AW4） | 検出（AL5, AL7, AL8, AW4, AW5, AW7） |
| MA7 あまいものあつめ：isStuck が「押せる列」を見ない（見つける：AL7・AW7） | 検出（AL7, AW1, AW2, AW3, AW4） | 検出（AL7, AL12, AW1, AW2, AW3, AW4, AW5, AW6, AW7, AW8, AW9, AW10, AW11, AW13, AW14, AW15, AW17, AW19, AW20, AW21, AW22, AW23, AW24） |
| MA8 あまいものあつめ：1手もどすで 2 手戻る（見つける：AL8・AW6） | 見逃し（full の項目で見つける設計） | 検出（AW6, AW7, X1） |
| MA9 あまいものあつめ：replay が押した手の t を見ない（見つける：AL8・AW3） | 検出（AL8） | 検出（AL8） |
| MA10 あまいものあつめ：validateSave が手の形を確かめない（見つける：AL9・AW3） | 検出（AL9） | 検出（AL9） |
| MA11 あまいものあつめ：ふたの箱が手前で開かない（見つける：AL5・AW20） | 検出（AL5） | 検出（AL5, AW20） |
| MA12 あまいものあつめ：こおりがとけない（見つける：AL5・AW20） | 検出（AL5） | 検出（AL5, AW20） |
| MA13 あまいものあつめ：hidden で 1 はこびを止めない（見つける：AW9） | 見逃し（full の項目で見つける設計） | 検出（AW9） |
| MA14 あまいものあつめ：古いページが書く（見つける：AW18） | 見逃し（full の項目で見つける設計） | 検出（AW18） |
| MA15 あまいものあつめ：ずかんに足すとき、ほかの絵を消す（見つける：AL9・AW17） | 検出（AL9） | 検出（AL9, AW17） |
| MA16 あまいものあつめ：ずかんの回数が増えない（見つける：AW17） | 検出（AL9, AW2） | 検出（AL9, AW2, AW17, AW23） |
| MA17 あまいものあつめ：運ぶ順が巣に近い順でない（見つける：AL4） | 検出（AL4） | 検出（AL4） |
| MA18 あまいものあつめ：押せない理由の順が違う（見つける：AL5） | 検出（AL5） | 検出（AL5） |
| MA19 あまいものあつめ：こおりの箱も押せる（見つける：AL5・AW20） | 検出（AL5, AL7） | 検出（AL5, AL7, AW20） |
| MA20 あまいものあつめ：保存の押した手の t が逆順でも通る・最後の t を超えても通る（見つける：AL9） | 検出（AL9） | 検出（AL9） |
| MA21 あまいものあつめ：面の生成の乱数が面ごとに同じ（見つける：AL6・AW3） | 検出（AL6） | 検出（AL6, AW22） |
| MA22 あまいものあつめ：くり返しで左右反転しない（見つける：AL13） | 検出（AL1, AL13, AW3） | 検出（AL1, AL13, AW3） |
| MA23 あまいものあつめ：足した絵より先にくり返しを選ぶ（見つける：AL13） | 検出（AL13） | 検出（AL13） |
| MA24 あまいものあつめ：recordBest が低い面でもベストを上書きする（見つける：AL9） | 検出（AL9） | 検出（AL9） |
| MA25 あまいものあつめ：演出中にずかんを開くとクリアのカードが消える（見つける：AW21） | 見逃し（full の項目で見つける設計） | 検出（AW21） |
| MA26 あまいものあつめ：演出中に遊び方を開くとクリアのカードが消える（見つける：AW21） | 見逃し（full の項目で見つける設計） | 検出（AW21） |
| MA27 あまいものあつめ：1手もどしを使ったのに「もどしなし」を書く（見つける：AW23） | 見逃し（full の項目で見つける設計） | 検出（AW23） |
| MA28 あまいものあつめ：クリアしても amai.clean に書かない（見つける：AW23） | 見逃し（full の項目で見つける設計） | 検出（AW23） |
| MA29 あまいものあつめ：カードの間もプレイ画面を inert にしない（見つける：AW24） | 見逃し（full の項目で見つける設計） | 検出（AW24） |
| MA30 あまいものあつめ：validateClean が重複・知らない id を捨てない（見つける：AL14） | 検出（AL14） | 検出（AL14） |
| MA31 あまいものあつめ：logic.js を事前キャッシュから外す（見つける：AW14） | 見逃し（full の項目で見つける設計） | 検出（AW14） |
| MR1 メニュー：最近遊んだゲームを先頭でなく後ろに足す（X-21） | 見逃し（smoke では見逃す設計） | 検出（E7, E8） |
| MR2 メニュー：最近遊んだ順に並べ替えない（X-21） | 見逃し（smoke では見逃す設計） | 検出（E7, E8） |
| MR3 メニュー：壊れた yubi.recent で落ちる（X-21） | 見逃し（smoke では見逃す設計） | 検出（E8, X1） |
| MR4 メニュー：カードを押した瞬間に並べ替える（押し間違い。X-21。v31 で置換元を click の形に合わせた） | 見逃し（smoke では見逃す設計） | 検出（E8） |
| MW65 もくもくこうば：表に戻ったとき保存がほかで変わっていても開き直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（WW26） |
| MW66 もくもくこうば：開き直す前（stale）でも保存を書く（X-20） | 見逃し（smoke では見逃す設計） | 検出（WW26） |
| MW67 もくもくこうば：裏へ回る・閉じるときの保存で比べ直さない（storage イベントが届く前に古い状態を書き戻す。X-20） | 見逃し（smoke では見逃す設計） | 検出（WW26） |
| MW68 もくもくこうば：かんな の baseTime を 5 に戻す（全部さいだい・はやい でも かんな が いちばん遅いまま。SZ-08） | 検出（WL14） | 検出（WL14, WW27） |
| MW69 もくもくこうば：もう強くできない部署にも「ここが おそい！」の札を出す（SZ-08） | 見逃し（smoke では見逃す設計） | 検出（WW27） |
| MW70 もくもくこうば：次の段で上限（CAPS）が増える部署でも「これいじょう はやく できないよ」と言う（moreNextStage が CAPS を見ない。S1） | —（full だけ流した） | 検出（WL14, WW27） |
| M24 ばいばいタイル：表に戻ったとき保存がほかで変わっていても開き直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（P10） |
| M25 ばいばいタイル：裏で別のタブが書いても保存を止めない（storage を見ない。X-20） | 見逃し（smoke では見逃す設計） | 検出（P10） |
| M26 ばいばいタイル：裏へ回る・閉じるときの保存で比べ直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（P10） |
| MD9 いろコード：表に戻ったとき保存がほかで変わっていても開き直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（I20） |
| MD10 いろコード：開き直す前（stale）でも保存を書く（X-20） | 見逃し（smoke では見逃す設計） | 検出（I20） |
| MD11 いろコード：裏へ回る・閉じるときの保存で比べ直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（I20） |
| MZ5 ゼンマイ：表に戻ったとき保存がほかで変わっていても開き直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（ZU16） |
| MZ6 ゼンマイ：開き直す前（stale）でも進み具合を書く（X-20） | 見逃し（smoke では見逃す設計） | 検出（ZU16） |
| MZ7 ゼンマイ：閉じるときの保存で比べ直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（ZU16） |
| MB23 いろびん：表に戻ったとき保存がほかで変わっていても開き直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（BW20） |
| MB24 いろびん：開き直す前（stale）でも保存を書く（X-20） | 見逃し（smoke では見逃す設計） | 検出（BW20） |
| MB25 いろびん：裏へ回る・閉じるときの保存で比べ直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（BW20） |
| MB26 いろびん：makeSave が上限を超えた手も書く（読むときに捨てられ面の最初に戻る。IB-09） | smoke は流していない | 検出（v36 の関門。BL・BW の全項目） |
| MB27 いろびん：予備の固定面（fallback 2）を verify に通さない（IB-11） | smoke は流していない | 検出（v36 の関門。BL・BW の全項目） |
| MB28 いろびん：最後の手まで保存された面を、クリアのカードなしで次の面にする（IB-22） | smoke は流していない | 検出（v36 の関門。BL・BW の全項目） |
| MQ42 まとめてポン：表に戻ったとき保存がほかで変わっていても開き直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（QW21） |
| MQ43 まとめてポン：裏で別のタブが書いても保存を止めない（storage を見ない。X-20） | 見逃し（smoke では見逃す設計） | 検出（QW21） |
| MQ44 まとめてポン：裏へ回る・閉じるときの保存で比べ直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（QW21） |
| MH21 ハシわたり：表に戻ったとき保存がほかで変わっていても開き直さない（X-20） | 見逃し（smoke では見逃す設計） | 検出（HW20） |
| MH22 ハシわたり：開き直す前（stale）でもベストを書く（pagehide で下げる。X-20） | 見逃し（smoke では見逃す設計） | 検出（HW20） |
| MH23 ハシわたり：閉じるときのベストの保存で比べ直さない（古いベストへ下げる。X-20） | 見逃し（smoke では見逃す設計） | 検出（HW20） |
| MP10 ピカッと：とても低い横画面ですき間を詰めない（SE Safari 横で 4 人の隅が重なる。X-17） | 検出（V2） | 検出（V2） |
| MR5 メニュー：修飾キーつき・左ボタン以外のクリックでも最近遊んだ順に入れる（別タブで開いただけで先頭。X-23） | 検出（E7） | 検出（E7, E8） |
| MR6 メニュー：Cmd（Meta）+クリックだけ最近遊んだ順に入れてしまう（X-23） | 見逃し（Meta は full の E8 だけで見る設計） | 検出（E8） |
| M27 ブロック：低い横持ち（高さ 319 以下）でスコア欄を広げない（LEVEL・LINES 5 桁が「…」。X-18） | （未計測。V12 は full） | 検出（V12） |
| MP11 ピカッと：対戦の途中で点があっても「メニューへ」を確かめない（PK-33） | 検出（PK4） | 検出（PK4, PK20） |
| MP12 ピカッと：最終結果（試合が終わった後）でも「メニューへ」を確かめてしまう（PK-33） | 見逃し（smoke では見逃す設計） | 検出（PK20） |
| MH24 ハシわたり：タイマーを片付けたとき案内を戻さない（隠す・遊び方で「ぴったり！」が残る。HS-01） | （未計測。HW21 は full なので見逃す設計） | 検出（HW21） |
| MH25 ハシわたり：最後のいのちで落ちたら、ぽちゃんを待たずに結果カード（HS-03） | （未計測。HW21 は full なので見逃す設計） | 検出（HW21） |
| MH26 ハシわたり：茎が最大になっても知らせない（grow が鳴り続ける。HS-02） | （未計測。HW21 は full なので見逃す設計） | 検出（HW21） |
| MH27 ハシわたり：カードの間、うしろのプレイ画面を inert にしない（HS-07） | （未計測。HW21 は full なので見逃す設計） | 検出（HW21） |
| MH28 ハシわたり：茎が最大のまま押下が取り消されても案内を戻さない（隠すと「いちばん ながい！ はなしてね」が残る。R1） | （未計測。HW21 は full なので見逃す設計） | 検出（HW21） |
| MP13 ピカッと：メニューへの確認カードに鍵をかけない（「メニューへ」の2度押しで点が消える。R2） | （未計測。PK20 は full なので見逃す設計） | 検出（PK20） |
| MP14 ピカッと：Space の押しっぱなし（repeat）を止めない（隅で押したままの Space で「つぎへ」が押される。R3） | （未計測。PK21 は full なので見逃す設計） | 検出（PK21） |
| MB29 いろびん：ちいさい びんにも 4 段入る（注ぐ量の上限を瓶ごとに見ない。IB-29） | smoke は流していない | 検出（v37 の関門） |
| MB30 いろびん：ちいさい びんを短く描かない（data-cap をいつも 4 にする） | smoke は流していない | 検出（v37 の関門） |
| MB31 いろびん：いろ きまりの びんにほかの色も入る | smoke は流していない | 検出（v37 の関門） |
| MB32 いろびん：いろ きまりの びんの札（色と記号）を描かない | smoke は流していない | 検出（v37 の関門） |
| MB33 いろびん：鍵の色をそろえても かぎの びんが開かない | smoke は流していない | 検出（v37 の関門） |
| MB34 いろびん：かぎの びんを押すと選べる（main の判定を外す） | smoke は流していない | 検出（v37 の関門） |
| MB35 いろびん：あとから来たお客さんが同じ動物でも ずらさない（IB-08） | 検出（BL21） | 検出（BL21。BW30 では検出しない＝画面側の避けがあるため。v39 の関門） |
| MB36 いろびん：生成の上限を 200000 に戻す（IB-12） | 検出（BL1・BL22） | 検出（BL1・BL22。v39 の関門） |
| MB37 いろびん：とける ところまで もどす が 1 手しか戻らない（IB-25） | smoke は流していない | 検出（BW29。v39 の関門） |
| MB38 いろびん：もう1つの枠に いま見えている動物を避けない（IB-08。ずらされた人が待つ間に来た人が同じ動物になる） | smoke は流していない | 検出（BW30。v39 の実行担当の確かめ） |
| MB39 いろびん：はじめての布が 8 面のまま（CLOTH_INTRO_LEVEL が 8。IB-33） | smoke は v41 で流していない | 検出（BL13, BL23, BL24, BW32。v41 の関門） |
| MB40 いろびん：毎面が節目になる（milestone が常に true。IB-24） | smoke は v41 で流していない | 検出（BL23, BW31, BW32。v41 の関門） |
| MB41 いろびん：「あたらしい きろく！」が毎面に出る（showRecord が improved だけ。IB-24） | smoke は v41 で流していない | 検出（BW31, BW32。v41 の関門） |
| MB42 いろびん：61 面から 10 色にしない（瓶が 11 本のまま。IB-43） | smoke は v42 で流していない | 検出（BL1, BL19, BL22, BL23, BL25, BW30, BW33。v42 の関門） |
| MB43 いろびん：1〜60 面も 10 色の中から色を選ぶ（前の面が変わる。IB-43） | smoke は v42 で流していない | 検出（BL19, BL24, BL25, BW16, BW29。v42 の関門） |
| MB44 いろびん：61〜69 面の軽い仕掛けの行が無い（IB-43） | smoke は v42 で流していない | 検出（BL19, BL25。v42 の関門） |
| MB45 いろびん：背の低い画面で瓶の背を低くしない（SE の Safari で瓶が重なる・切れる。IB-44） | smoke は v42 で流していない | 検出（BW33。v42 の関門） |
| MB46 いろびん：むらさきの記号「つき」を描かない（予備の ● になる。IB-43） | smoke は v42 で流していない | 検出（BW33。v42 の関門） |
| MB47 いろびん：= キーで 12 本目を選べない（IB-43） | smoke は v42 で流していない | 検出（BW33。v42 の関門） |
| MB52 いろびん：開き直したクリアのカードで、なかよしちょうの数を二重に足す（IB-34） | 見逃し（full の項目で見る） | 検出（v45 の関門のあと。full）：BW36（c） |
| MB53 いろびん：なかよしちょうの負の数・小数を捨てない（IB-34） | 検出（BL26（d）） | 検出（v45 の関門のあと。full）：BL26（d）、BW36（d） |
| MB54 いろびん：新しい版の なかよしちょうを書きかえる（IB-34） | 検出（BL26（c）） | 検出（v45 の関門のあと。full）：BL26（c）、BW36（e）、BW37（f） |
| MB55 いろびん：なかよしの段が 1 つ遅れる（IB-34） | 検出（BL26（f）） | 検出（v45 の関門のあと。full）：BL26（f）、BW37（a） |
| MB56 いろびん：面の星を良い方でなく今回の値で上書きする（IB-34） | 検出（BL26（e）） | 検出（v45 の関門のあと。full）：BL26（e） |
| MB57 いろびん：クリアの帳面の書き込みが X-20 の見張り（stale）を通らない（IB-34） | 見逃し（full の項目で見る） | 検出（v45 の関門のあと。full）：BW36（f）（f2） |
| MB58 いろびん：帳面を次の面の保存（irobin.save）より後に書く（IB-34） | 見逃し（full の項目で見る） | 検出（v45 の関門のあと。full）：BW36（g） |
| MB59 いろびん：setState の局面のクリアでも帳面を書く（IB-34） | 見逃し（full の項目で見る） | 検出（v45 の関門のあと。full）：BW36（g） |
| MB60 いろびん：なかよしちょうを開く・閉じた直後の押せない時間を消す（IB-34） | 見逃し（full の項目で見る） | 検出（v45 の関門のあと。full）：BW37（d） |
| MB61 いろびん：錠の数に、隠れた段がある瓶も数える（IB-57） | 検出（BL27） | 検出（BL27。v47） |
| MB62 いろびん：錠の数に、別の色が混ざった瓶も数える（IB-57） | 検出（BL27） | 検出（BL27。v47） |
| MB63 いろびん：錠の数に、鍵の瓶の中身も数える（IB-57） | 検出（BL27） | 検出（BL27。v47） |
| MB64 いろびん：錠の数に、ちいさい びんも数える（IB-57） | 検出（BL27） | 検出（BL27。v47） |
| MB65 いろびん：錠の数に、布の瓶も数える（IB-57） | 検出（BL27） | 検出（BL27。v47） |
| MH29 ハシわたり：ぴったりを続けても いのちが戻らない（HS-09） | smoke は流していない | 検出（v37 の関門） |
| MH30 ハシわたり：いのちが上限を超えて戻る（HS-09） | smoke は流していない | 検出（v37 の関門） |
| MH31 ハシわたり：ステージでも いのちが戻る（HS-09） | smoke は流していない | 検出（v37 の関門） |
| MH32 ハシわたり：案内に倍々・回復の言葉を出さない（HS-09） | smoke は流していない | 検出（v37 の関門） |
| MH33 ハシわたり：画面の大きさが変わっても空と水のグラデーションを作り直さない（HS-10・T-25） | v38 の関門で検出 | v38 の関門で検出 |
| MF30 ミチビキ空港：newGame が置き方を見ない（MC-15） | smoke は流していない | 検出（v37 の関門） |
| MF31 ミチビキ空港：着陸の判定だけ置き方 0 の滑走路で見る（MC-15） | smoke は流していない | 検出（v37 の関門） |
| MF32 ミチビキ空港：毎回同じ置き方を選ぶ（MC-15） | smoke は流していない | 検出（v37 の関門） |

v40（2026-10-25、ほしくだき：いなずま・たま・どかん）：変異 MK46・MK47（書き直し）と MK75〜MK83 の 11 個を流す（`ONLY=KL1〜KL23,KW26 M=MK46,MK47,MK75〜MK83`）。結果：full 11/11 検出（関門 2026-10-25）。関門は Chromium smoke 200/200・full 408/409（WW10 は単独で合格。T-33）・WebKit smoke（画面あり）198/198。MK82・MK83 はレビューのあとに足した。MK83 は render.js の変異で KW26（full だけ）が見つける。置換対象なしが 0 であることを一覧で確かめる。

v39（2026-10-25）：いろびん MB1〜MB38（MB35〜MB38 が新しい。IB-08・IB-12・IB-25）と、X-20 の 24 個（MW65〜67・M24〜26・MD9〜11・MZ5〜7・MB23〜25・MQ42〜44・MH21〜23・MK62〜65）を x20Run の直し（X-24 の確かめを足した）のあと流す。結果：いろびんは full 31/32 検出。見逃しの MB28 は、流した ONLY に BW22 が入っていなかったため（`ONLY=BW22 M=MB28` で検出を確かめ、93 行の ONLY に BW22〜BW24 を足した）。X-20 は full 25/25 検出（数えると 25 個）。M18・M19 も full で検出。MB37 の置換元は `rewindTarget` の探す `for` の行、MB38 は render.js の `nextAnimal` の行。

v41（2026-10-26）：いろびん MB1〜MB41（MB39〜MB41 が新しい。IB-33・IB-24。結果は関門のあとの Haiku の報告で書く）。

v42（公開日は後で記入）：いろびん MB1〜MB47（MB42〜MB47 が新しい。IB-43・IB-44。`PORT=8706 WORKERS=1 ONLY=BL1,BL19,BL20,BL24,BL25,BW33 M=MB42,MB43,MB44,MB45,MB46,MB47 node tests/mutants/mutate.mjs both`。6 つとも「検出」が合格。結果は関門のあとの Haiku の報告で書く）。

v45（2026-10-27）：いろびん MB1〜MB60（MB52〜MB60 が新しい。IB-34。`M=MB52,MB53,MB54,MB55,MB56,MB57,MB58,MB59,MB60 node tests/mutants/mutate.mjs both`。9 つとも「検出」が合格。v45 の関門のあとに流し、full で 9 つとも検出。MB56 は BL26 が ONLY に無く一度見逃しになったので、ルール・保存・生成の ONLY に BL26 を足した。MB28 は v45 で onClear の呼び方が変わり置き換え前の文字が無くなったので、定義を今の main.js に合わせた（BW22・BW36 が検出））。

v47（公開日は後で記入）：いろびん MB1〜MB65（MB61〜MB65 が新しい。IB-57。`ONLY=BL27 M=MB61,MB62,MB63,MB64,MB65 node tests/mutants/mutate.mjs both`。5 つとも BL27 が検出するはず。結果は関門のあとの Haiku の報告で書く）。

v38（2026-10-24）：V8 を消したあと M6・M13、HW22 の直しの MH33v38 の関門で検出。

v37（2026-10-24）：新しい変異 13 個（v37 の関門で full 13/13 検出。MB32 は置換元をレビューの直しに合わせて検出）。MB2・MB15・MB16 は置換前の文字を新しいコードに合わせた。局面のキーの 3 文字目（仕掛けの印）を落とす変異は、瓶が印ごとに分かれて並び、落としても局面が重ならないので作らない。

v36（2026-10-24）：MB7・MB17・MB26〜MB28 を full で流し、5/5 検出（見逃し・置換対象なし 0。ONLY は BL1〜BL15・BW1〜BW24・X1）。MB26〜MB28 は IB-09・IB-11・IB-22 の新しい変異。

かんな の直し（2026-10-23、v33、SZ-08。Chromium・`PORT=8800 WORKERS=2`、`ONLY=WL14,WW27,X1`）：MW68・MW69 を smoke 1/2・full 2/2 で検出（MW68 は WL14・WW27、MW69 は WW27。smoke の見逃し MW69 は WW27 が full なので見逃す設計）。かんな の数値を変えたので、かんな に関わる既存の MW51〜MW54・MW57〜MW60 も `ONLY=WL1〜WL10,WL12〜WL14,X1` で流し、8/8 検出（置換元はずれていない）。

レビュー後の直し（2026-10-23。Chromium・`WORKERS=3`、full だけ）：ほしくだき T1（はね返し・2択の間に閉じたときの予約）と UX の文言・札・知らせ・目盛りの位置。`ONLY=KL1〜KL19,KW1〜KW25,X1` で `M=MK59,MK60,MK67,MK68,MK70,MK71,MK72,MK73,MK74` を 9/9 検出（置換対象なし 0。MK67 は文言に合わせて置換元を直した）。もくもくこうば S1（次の段で上限が増える部署は「つぎの だんで もっと ふやせるよ」）・S2（maxedOut を組が変わったときだけ聞く）。`ONLY=WL1〜WL14,WW1〜WW27,X1` で `M=MW68,MW69,MW70` を 3/3 検出（MW68 は WL14・WL11・WW10・WW27）。KW3 は 10 回続けて 0 回落ちた。

v31（2026-10-22、合流の作業。Chromium・`WORKERS=2 PORT=8800`、項目を絞って full）：MR1〜MR6（`ONLY=E1,E7,E8,X1`）6/6、M27（`ONLY=V12,X1`）1/1、MP11・MP12（`ONLY=PK4,PK20,X1`）2/2、MH24〜MH27（`ONLY=HW21,X1`）4/4、MW41・MW42（`ONLY=WW18,X1`）2/2 を検出。smoke は MR5・MR6・MP11・MP12 だけ流し、MR5（E7）・MP11（PK4）を検出、MR6・MP12 は full の E8・PK20 で見つける設計。MR4 は click の中身が変わったので置換元を差し替え、MW41・MW42 は今の `readingCard()` に合わせた（T-15）。X-20 の部品を lib.mjs にまとめた（T-14）あとの確かめとして、X-20 の変異 21 個（MW65〜67・M24〜26・MD9〜11・MZ5〜7・MB23〜25・MQ42〜44・MH21〜23、`ONLY=WW26,P10,I20,ZU16,BW20,QW21,HW20,X1`）を full で 21/21 検出（見逃しなし。まとめる前と同じ項目が見つける）。

v31 のレビュー後の直し（2026-10-22。Chromium・既定の PORT、項目を絞って full）：MH28（`ONLY=HW21,X1`）1/1、MP13・MP14（`ONLY=PK20,PK21,X1`）2/2 を検出。MP11・MP12・MH24〜MH27 の置換元は変わっていない。

メニューの並びと古いページの書き戻し（2026-10-22、v30。MR1〜4・MW65〜67・M24〜26・MD9〜11・MZ5〜7・MB23〜25・MQ42〜44・MH21〜23・MP10 の 26 個）：すべて検出（full 26/26。smoke の見逃しは新しい項目が full だけの設計のため。MP10 の V2 は smoke でも検出）。MW67・M26・MD11・MZ7・MB25・MQ44・MH23 は、レビュー後の直し（878b5af）で足した `staleOnHide()` の比べ直しを消すもの。置換元がずれていた MD3・MB22・MQ41・MW33 は今のコードに合わせた。

さいしょから（2026-10-22、v29、fix/seizai-carry。Chromium・`WORKERS=2`）：もくもくこうば `ONLY=WW25 M=MW61〜MW64 PORT=8800` で smoke 0/4・full 4/4、ほしくだき `ONLY=KW6,KW21 M=MK6,MK7,MK18,MK38〜MK41 PORT=8900` で smoke 3/7・full 7/7 を検出（smoke の見逃しは MW61〜64・MK38〜41 で、WW25・KW21 は full なので見逃す設計）。同日、消せないときの扱い（契約 §19.2 R6）を直したあと `ONLY=KW21 M=MK38,MK39,MK40,MK41,MK42 PORT=8900` で smoke 0/5・full 5/5 を検出（MK42「消せないときヒントを出さない」を足した）。保存の既存の変異 MK6・MK7・MK18 も KW6 で引き続き検出。もくもくこうばの保存の既存の変異（分類「保存」の MW18〜MW21・MW35・MW38・MW44・MW47・MW49・MW53、`ONLY=WL1〜WL13,WW1〜WW25 PORT=9640`）も smoke 10/10・full 10/10 で検出。

ちきゅうを守れ！ほしくだき（2026-10-21、feature/asteroid-test。Chromium・`PORT=9650 WORKERS=2`、`ONLY=KL1〜KL12,KW1〜KW17`、10 個ずつ 3 回）：MK1〜MK22 を smoke 16/22・full 22/22 で検出。smoke の見逃し MK8・MK19・MK20（中断）・MK9・MK10（オフライン）・MK21（動きを減らす）は full の KW11・KW16・KW13 で見つける設計。MK5（場を押すと進む）は最初 #fieldCanvas に付けたが、canvas は `pointer-events: none` で押しても届かない（同じ動きの変異）ので、親の #field に付け直して KW4 で検出。ロジックの数値は調整中（契約 §17）なので、数値を変えたら KL・KW と MK1〜MK4・MK22 を流し直す。

ちきゅうを守れ！ほしくだき 作り直し（2026-10-23、claude/v30-handoff-docs-tftm14。Chromium・`WORKERS=3 PORT=9650`、`ONLY=KL1〜KL19,KW1〜KW25,X1`、`M=MK1〜MK72` を 1 回で full だけ）：置換対象なし 0、MK1〜MK72 を full 72/72 で検出。置換元を直したのは MK3・MK6・MK8・MK20（「カードが出ている間も止めない」。T-15）・MK22・MK23・MK39 で、ほかは同じ文字が今のコードに 1 回だけある。足したのは MK43〜MK72（契約 §11.4）。最初は MK63（saveNow が stale を見ない）・MK64（staleOnHide）を見逃した：x20Run の (d2) は直前の pagehide で sleep 済みのページで行うので、ほしくだき（sleep は 1 回だけ）では hidden の保存が起きない。KW25 に「起きているページで見えている間に書かれ、そのまま裏へ回る」と「「ほぞんが できないよ」は pagehide の前に待って読む」を足して 2/2 を検出。KL19（重さ。1 step の中央 1ms 以下）は 3 並列の負荷で落ちることがあり、main.js の変異（MK32・MK40）でも「検出」に名前が出る（KL19 だけでは数えていない。どれもほかの項目で検出）。mutate.mjs は M に 72 個を並べると結果のファイル名が長すぎて最後の表の書き出しで止まる（ENAMETOOLONG。1 行ずつの結果は表示される）。

ちきゅうを守れ！ほしくだき §18 のあと（2026-10-21、feature/asteroid-test2。Chromium・`PORT=9650 WORKERS=2`、`ONLY=KL1〜KL15,KW1〜KW20`、10 個ずつ 4 回）：MK1〜MK37 を smoke 29/37・full 37/37 で検出。smoke の見逃しは MK8・MK19・MK20（中断）・MK9・MK10（オフライン）・MK21（動きを減らす）・MK30・MK35（◎・2択の案内。KW20 は full）で、どれも full で見つける設計。MK25（もろい底なし）は smoke では KW6 でも落ちた（星の途中の保存の検査で、底が硬いと再読み込みまでの間の欠け方が変わる）が、full の KW6 は合格し KL1・KL11・KL15 で検出。MK29（tryAt をずらさない）は、このとき直した AS-T5 の戻りを KW5・KW6 で見つける。

もくもくこうば v26（2026-10-21、画面とロジックの仕上げ 0ebc6ec を組み合わせた後。Chromium・`PORT=9640 WORKERS=2`、`ONLY=WL1〜WL13,WW1〜WW23`）：画面を変える既存の変異 MW3・MW9・MW20・MW21・MW28・MW30〜MW44 と MW56 の 21 個を smoke 14/21・full 21/21 で検出（見逃しなし）。smoke の見逃しは MW28・MW30・MW31・MW34・MW41〜MW43 で、前回と同じく full の WW8・WW16・WW11・WW18 で見つける設計。新しく MW3 は WW10・WW18、MW36 は WW21、MW43 は WW23、MW56 は WW22（Lv5→6 で tool を鳴らさない）でも見つかる。

もくもくこうば（2026-10-21、レビュー後の直し §17 のあと。Chromium・`PORT=9640 WORKERS=2`、`ONLY=WL1〜WL11,WW1〜WW18`、10 個ずつ 5 回）：MW1〜MW50 を smoke 43/50・full 50/50 で検出。smoke の見逃しは MW28・MW30・MW31・MW34（前回と同じ）と MW41〜MW43（full の WW18 で見つける設計）。MW21 は keepBroken の書き換えで置換前の文字が変わったので直した。

もくもくこうば（2026-10-21、feature/seizai の組み合わせ後・レビューの直しの前。Chromium・`PORT=9640 WORKERS=2`、`ONLY=WL1〜WL11,WW1〜WW17`、10 個ずつ 4 回）：MW1〜MW39 を smoke 35/39・full 39/39 で検出。smoke の見逃し MW28（2せき目のエンディングのカード）・MW34（pagehide のタイマー）は full の WW8・WW11、MW30・MW31（APP_FILES から外す）は full の WW16 で見つける設計（ONLY に L5 を入れれば smoke の L5 でも見つかる）。WW3 の既知の不具合 W-K1（SZ-01、capped がいつも false）は合否に含めないので、どの変異も「検出」に見えることはない。

ミチビキ空港（2026-10-20、レビュー後の直し §19 を取り込んだ後。Chromium・`PORT=9520 WORKERS=2`、`ONLY=FL1〜FL12,FW1〜FW5,FW7〜FW23`、10 個ずつ 3 回）：MF1〜MF29 を smoke 27/29・full 29/29 で検出（smoke の見逃し MF27・MF28 は full の FW22・FW23 で見つける設計）。**この回は FW6 を ONLY から外した**（SE 横で 5 桁の着陸数が 3px はみ出す不具合が残っていて、full がいつも不合格になり、どの変異も「検出」に見えてしまうため）。はみ出しは同じ日に直した（横向きのメニューのボタンを詰めた。FW6 合格）ので、**次回からは FW6 を ONLY に戻す**（`ONLY=FL1〜FL12,FW1〜FW23`）。MB22（`ONLY=BL1〜BL14,BW1〜BW19`）・MQ10・MQ41（`ONLY=QL1〜QL11,QW1〜QW20`）は full 3/3 を検出。直しの前（MF1〜MF7）でも全部検出していた。

まとめてポンの 5こ以上・まわり +3 点（2026-10-20、ユーザー決定、Chromium・`PORT=9950 WORKERS=2`、`ONLY=QL1〜QL11,QW1〜QW19`、10 個ずつ 4 回）：MQ1〜MQ40 を smoke 26/40・full 40/40 で検出。MQ29 は「BIG が 6」、MQ35 は「v:2 の手を捨てない」、MQ7 の置換前を `o.v !== 2` 入りに合わせた。MQ38（演出 +0.4 秒）は最初 full でも見逃した（QW19 で見る 3 手が 0.42〜0.49 秒で、+0.4 秒でも 0.9 秒を超えない）ので、QW19 に「種 1〜4 ふつう・種 1〜2 やさしいの まわりも消える手 39 回の演出の最大も 0.9 秒以内」（いまの最大 0.64 秒）を足して検出するようにした。

いろびんの布の瓶（2026-10-20、v22、Chromium・`PORT=9900 WORKERS=2`、`ONLY=BL1〜BL14,BW1〜BW18`）：MB1〜MB17・MB19 を smoke 14/18・full 18/18 で検出（smoke の見逃し MB8・MB9・MB11・MB12 は full の BW9・BW6/BW8・BW16 で見つける設計）。MB18（新しい色の4段を布の外にも配る）はユーザー決定で「新しい色」を作らないので欠番。表の MB1〜MB14 の検出欄はこの回の結果に更新した。

いろびんの布の考えどころ（2026-10-20、契約 §17.9、Chromium・`PORT=9900`、`ONLY=BL1〜BL14,BW1〜BW18`）：MB1〜MB17・MB19〜MB21 を smoke 16/20・full 20/20 で検出（smoke の見逃しは MB8・MB9・MB11・MB12 で、設計どおり full の BW9・BW6/BW8・BW16 で見つける）。

※ M19 は本来 full の P9 で見つけるもの。smoke で P8 が落ちたのは、同時に 2 つの的を切った・落としたときに P8 が 1 つずつ前提で判定していたため（負荷の高いときだけ起きる）。P8 を「切った数・落とした数に合わせて判定」と「軌跡の 0.2 秒はページの時間を止めて進める」に直した。直した後に M19 を smoke で流し直し、見逃し（設計どおり full のみ）を確認した。

M10 は最初、どのテストも見逃した（2 回目のタップは別の仕組みでも止まるため）。盤面は「1 回目から常に止める」作りなので、T5 にその確認を足して検出できるようにした。
