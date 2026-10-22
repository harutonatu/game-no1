# 引き継ぎ（新しい会話の人へ）

作成日：2026-10-22（v28 を公開し、SZ-04・SZ-05 の直しを `fix/seizai-carry` に作った直後）。前の版（v27 の時点）を書き直したもの。
**ここからは自宅 PC（Windows）の Claude Code で開発・テストする**（ユーザー決定「クラウドではなく自分のPCで開発、テストしたいです。」）。

## 0. 使い方

新しい会話の最初の一言の例：「docs/handoff.md を読んで、続きから進めて」

この文書は「**今どこにいるか**」だけを書きます。決めごと・課題・案は、次のファイルを正としてください（重複は書きません）。

| 知りたいこと | 見る場所 |
|---|---|
| 決めごと（答え方・進め方・テスト・git） | [CLAUDE.md](../CLAUDE.md) |
| 課題・改善案の一覧（未着手・作業中） | [docs/issues.md](issues.md)（終わったものは [docs/issues-done.md](issues-done.md)） |
| もくもくこうばの約束（今回の直しは **§20**） | [docs/seizai-contract.md](seizai-contract.md) |
| ほしくだきの約束 | [docs/asteroid-contract.md](asteroid-contract.md) |
| iPhone の遠隔テスト（中継）の計画と段4の結果 | [docs/iphone-relay-plan.md](iphone-relay-plan.md)、約束は [docs/debug.md](debug.md) の 5 章 |
| テストの流し方・中継の使い方・実機確認リスト | [tests/README.md](../tests/README.md) |
| ゲーム案 | [docs/game-plan.md](game-plan.md) |

## 1. 今の状態

| 項目 | 内容 |
|---|---|
| 公開版 | `master`、**v28・2026-10-22**（中継を足した版。遊び方は v27 と同じ） |
| 作業中のブランチ | **`fix/seizai-carry`**（729d5aa、push 済み・未公開）：もくもくこうばの SZ-04・SZ-05 の直し。版はまだ上げていない |
| 自宅 PC の準備 | 確認済み（2026-10-22）：Claude Code 2.1.302、Node v24.20.0、Playwright 1.64.1（グローバル） |

## 2. 次にやること（この順で）

1. **`fix/seizai-carry` を取り込む**：`git fetch origin` → `git worktree add <場所> fix/seizai-carry`（CLAUDE.md 6 章）。
2. **レビュー**：技術（Opus）と UX（Sonnet）を同時に。対象は `git diff origin/master...fix/seizai-carry`（games/seizai/actors.js・render.js・main.js、tests/cases/seizai-ui.mjs の WW24、WW20 の前半の変更）。
3. **ユーザーに判断してもらうこと（直しの担当からの申し送り）**：E2 の決まりどおりにすると、きこりが少し遅いくらいの普段の局面では、v26（SZ-03）で足した「きりかぶ まち」の吹き出しと「きこりを ふやすと うえられるよ」の文が出なくなる（つまりの札「ここが おそい！」は残る）。そのため WW20 の前半の局面を「森が若木だけの開いた直後」に変えた。これでよいかを実機で見てもらう。
4. **直し → 版を v29 に上げる**（version.js の version・date と sw.js の CACHE_VERSION。日付は公開する日）。
5. **関門テスト**（自宅 PC。tests/README.md）：Chromium smoke と full、WebKit smoke（`WORKERS=1`）。logic.js は変えていないので変異テストは流さない。
   - Windows の WebKit には AudioContext が無く、A4 が「対象外」になるのは既知（不合格ではない）。
   - 並列数：Chromium は `WORKERS=4` 前後から（以下は私の推測）。WW10（性能）は並列で落ちやすいので、落ちたら単独で流し直して分ける。
6. **ユーザーに結果を見せて承認 → 公開**（fast-forward：`git push origin fix/seizai-carry:master`）。
7. **中継で実機を確かめる**（tests/README.md「iPhone の遠隔テスト（中継）の使い方」）：もくもくこうばを `?debug=1&relay=1&key=…` 付きの URL で直接開き、`node tests/relay/ask.mjs state` の `carryTrips` が増えていくこと・`waits` に "in" が出続けないことを見る。あわせて、はこぶ人が門まで歩くかを目で見てもらう。
   - 自宅の Wi-Fi で使う URL は `http://192.168.1.13:8790/…`（ほかに出る 192.168.56.1・172.26.x.x は仮想のネットワーク。課題 T-12）。
   - 命令 `open` で移ると、移った先でつながらない（課題 T-11）。移りたいページは URL で直接開く。

## 3. この会話でやったこと（2026-10-22）

- **ユーザーの実機の感想を課題管理表へ**：ほしくだき AS-01〜AS-06（砲台にする・まわりから撃つ・マスを細かく・いなずまとてつ・さいしょから・武器を外せるように。AS-06 はユーザーの方向「いつでも削除が可能」と PM の案つき）、もくもくこうば SZ-04〜SZ-07（まるた まち・さいしょから）、横展開 X-19。もくもくこうばは画面録画 2 本から原因を切り分けた（logic は正しく、見せ方の問題）。
- **iPhone の遠隔テスト（中継）を作って v28 で公開**（T-10、済）：tests/relay/relay.mjs・ask.mjs、common/debug-relay.js、テスト RL1〜RL10。技術レビューで合言葉の弱さ（4 けた）を直した（8 文字・別サイトを断る・5 回で締め切り）。ユーザーの承認「バージョン28は交換してください」（「公開」の聞き間違い）で公開。v28 の関門：Chromium smoke 179/179・full 342/342、WebKit smoke 174/177（BW2・WW1・WW5。既知の不安定、T-09）。
- **段4（自宅 PC で iPhone とつなぐ確認）に合格**：iPhone の Safari の見えている高さは 714px、もくもくこうばは実機で重いコマ 0/3212。
- **SZ-04・SZ-05 を直した**（`fix/seizai-carry`、未公開）：はこぶ人は「運べる券」（実際に運んだ数）で動く。「まち」は前の品が無く最近作っていないときだけ。Node で録画の局面を 290 秒：門まで 0 回→106〜116 回、「まち」100%→0%。テスト WW24 を追加。Chromium の WW・WL 38/38 合格。WebKit は Target crashed（MT-14）が直す前と同じ確率で出る。

## 4. そのあとの候補（おすすめ順）

1. もくもくこうばの公開と実機確認（上の 2 章）。
2. 中継の T-11（`open` でつながらない）・T-12（URL の並び）。
3. 「さいしょから」SZ-07・AS-05・X-19。
4. ほしくだきの武器の仕組みの見直し（AS-04・AS-06）と見た目（AS-01〜AS-03）。
5. テストの時間（T-08・T-09）。

## 5. 作業環境のこと

### 自宅 PC（Windows、6コア12スレッド、16GB）
- リポジトリは `C:\tools\vm\share\701．ゆびあそび\game-no1`。作業前に `git switch master` と `git pull origin master`。
- PowerShell では環境変数を `$env:WORKERS=4; node tests/run.mjs full` の形で書く（CLAUDE.md 5 章）。
- 中継を使うときは、中継用の PowerShell の窓を別に開いたままにする。ファイアウォールの画面は段4では出なかった。

### 会社 PC
- **監視ソフトがある**。テストと中継は使わない。

### クラウド（使う場合）
- 4コア。テストは担当ごとに `PORT` を分ける。コンテナがときどき再起動する。WebKit は `WORKERS=1`。

## 6. 進め方で学んだこと（この会話で追加したもの）

- 画面録画は ffmpeg で 1 秒ごとの絵に切り出して見ると、状態（人数・Lv・吹き出し）まで読める。
- 原因の切り分けは、ロジックと動きを Node で録画と同じ局面にして回し、「数（logic）」と「絵（actors）」を比べると早い。
- 実機の確認は、ユーザーが命令を打って結果を貼る形でも進められた（クラウドからは自宅の iPhone に届かないため）。
- 音声入力の聞き間違い（例：「交換」＝「公開」、「丸太町」＝「まるた まち」）は、文脈から読み、読み替えたことを答えに書く。
- 以前の学び（約束に章を足してから担当に渡す・同じファイルを2人に触らせない・レビューは作った直後に技術と UX を同時に・公開は承認のあと fast-forward など）は、git の履歴の前の版（2026-10-21）を参照。
