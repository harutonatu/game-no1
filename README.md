# ゆびあそび

iPhone・iPad で遊ぶための、指先ゲームの小さな集まりです。インストール不要で、ブラウザで開くだけで遊べます。

**遊ぶ：https://harutonatu.github.io/game-no1/**

## 遊べるゲーム（8本）

| ゲーム | ひとこと |
|---|---|
| ブロックパズル | 落ちてくるブロックで横一列をそろえて消す |
| ばいばいタイル | 同じ数字をぶつけて合体、2048 を目指す |
| キリトリ道場 | 飛んでくる的を指でなぞって切る。爆弾に注意 |
| いろコード | 4つの色の並びを推理する |
| ゼンマイさんぽ | ネジを巻いて、崖の手前でぴたりと止める |
| ピカッと早押し | ひかったら タップ！ いちばん はやいのは だれ？ |
| ハシわたり | ながおしで くきを のばして、つぎの葉へ |
| いろびん | いろみずを そろえて、どうぶつに とどけよう |

## ホーム画面に追加する（iPhone・iPad）

1. Safari で上のURLを開く
2. 画面の共有ボタン（四角から上向きの矢印）を押す
3. 「ホーム画面に追加」を選ぶ

追加すると、ふつうのアプリのように起動できます。一度開けば、電波がない場所（オフライン）でも遊べます。

**更新されたかの確かめ方**：メニュー画面の一番下に、版と日付（例：`v20・2026-10-19`）が出ています。ホーム画面のアプリを2回開き直すと、新しい版になります（1回では古い版のままのことがあります）。

## 方針

- 広告なし・課金なし・ログイン不要
- 記録（ベストスコアなど）は、使っている端末の中（localStorage）にだけ保存します。サーバーには送りません

## 作り方

ビルド不要の静的サイトです。HTML・CSS・JavaScript をそのまま配信しています（公開先は GitHub Pages、`master` ブランチが公開版）。

| 場所 | 役割 |
|---|---|
| `index.html` | メニュー画面。ゲーム一覧と、最下部の版表示 |
| `games/<名前>/` | 1ゲーム1フォルダ（`blocks` `2048` `kiritori` `irocode` `zenmai` `pikatto` `hashi` `irobin`） |
| `common/sfx.js` | 共通の効果音 |
| `common/version.js` | 版の表示（`version` と `date`） |
| `sw.js` | Service Worker。ファイルを端末に保存して、オフラインでも動かす |
| `manifest.webmanifest` `icons/` | ホーム画面に追加するための設定と画像 |
| `tests/` | 統合テスト（Playwright） |
| `docs/` | ゲーム案の記録、課題管理表など |

- 効果音は Web Audio でその場で合成しています（音声ファイルはありません）。
- 絵も、画像ファイルではなくプログラム（Canvas など）で描いています。

## 開発者向け

テストには Node.js（18 以上）と Playwright が必要です。リポジトリのルートで流します。

```sh
node tests/run.mjs smoke     # 小さな修正のたびに
node tests/run.mjs full      # 公開前に
BROWSER=webkit WORKERS=1 node tests/run.mjs smoke   # Safari と同じエンジンで
```

WebKit は初回だけ `node "$(npm root -g)/playwright/cli.js" install webkit` で入れます。公開の条件など詳しいことは次を見てください。

- [tests/README.md](tests/README.md)：テストの流し方と項目
- [CLAUDE.md](CLAUDE.md)：開発の決めごと（版の上げ方、git の運用など）
- [docs/game-plan.md](docs/game-plan.md)：ゲーム案の記録
- [docs/issues.md](docs/issues.md)：課題管理表

## AI について

このリポジトリは、AI の Claude Code を使って作っています。
