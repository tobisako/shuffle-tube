# ShuffleTube

YouTube 動画の **好きな区間（クリップ）だけ** を並べて連続再生するプレイリストアプリです。
「この動画の 0:39 から 10 秒」のような区間を 1 件として登録し、1 本の動画から何か所でも区間を作れます。

ShuffleTube is a playlist app that plays only the parts you want from YouTube videos.
Register clips (start / end) from any video, order them, loop them, and edit ranges with a drag‑and‑drop timeline.
Runs as a desktop app (macOS / Windows, Electron) and in a phone browser on your LAN (served by the desktop app).

- 再生は YouTube の公式埋め込みプレーヤー（IFrame Player API）。動画のダウンロードや広告除去は行いません
- API キー・ログイン不要
- ライセンス: MIT

## できること

- **クリップ**: 動画 ID + 開始秒 + 終了秒（終了なし = 最後まで）。1 つのクリップに区間を最大 5 つ作れ（上から順に続けて再生）、区間ごとに色を付けられます。同じ動画から別のクリップも作れます
- **区間編集は GUI**: 再生しながら「⏺ 開始点」「⏹ 終了点」を押して追加。行の ✎ でタイムラインのつまみをドラッグ、ホイール / ピンチで拡大縮小、±1秒 / ±0.1秒 ボタン、「最後まで」
- **連続再生**: 区間の終わりで自動的に次のクリップへ。同じ動画ならシークだけで切り替え。シャッフル、リピート（オフ / 全曲 / 1曲）
- **ライブラリ**: URL を貼って動画を溜め、一覧からプレビュー再生しながら区間を切り出す
- **プレイリスト複数**、並べ替え、視聴履歴、JSON 書き出し / 読み込み
- **スマホ連携**: PC が LAN サーバーになり、同じ Wi-Fi のスマホのブラウザで同じデータを使える（スマホ用のアプリは無く、ブラウザだけで動く）
- 設定で個別 ON/OFF: メディアキー、常に最前面、ミニプレーヤー、音量・速度の記憶、履歴、スリープ防止

詳細は [docs/仕様.md](docs/仕様.md) を参照してください。

## インストール

[Releases](https://github.com/tobisako/shuffle-tube/releases) からダウンロードします（署名していないため、初回起動時に OS の警告が出ることがあります）。

| プラットフォーム | ファイル | 備考 |
|---|---|---|
| macOS (Apple Silicon) | `ShuffleTube-x.y.z-mac-arm64.dmg` | 右クリック →「開く」で Gatekeeper を通す |
| Windows (x64) | `ShuffleTube-x.y.z-win-x64.exe`（インストーラ） / `portable` | SmartScreen の警告は「詳細情報」→「実行」 |

自分でビルドする場合は下の「開発」を参照してください。

## 使い方

1. 入力欄に YouTube の URL（通常動画・Shorts・短縮 URL・動画 ID・再生リスト URL）を貼り付けて「追加」。URL に `t=39` があればその位置が開始になります
2. クリップをクリックすると、その区間から再生。終了位置で自動的に次へ。プレーヤーの下のバーに、動画全体に対する区間（赤）・同じ動画の他のクリップ（白）・マーク中の区間（黄）が表示されます
3. **区間を作る**: 再生しながら「⏺ 開始点」「⏹ 終了点」→「＋ この区間をクリップとして追加」。または行の ✎ でタイムラインを開いてつまみをドラッグ。編集中はその区間を繰り返し再生します。行の ＋ で同じ動画から別の区間を追加
4. 並べ替えはドラッグまたは ↑↓、削除は ✕。サイドバーでプレイリストを切り替え、「履歴」で再生したクリップを振り返り

### ライブラリ

サイドバーの「📚 ライブラリ」で URL を貼って「保存」すると動画が溜まります。行をクリックするとプレビュー再生され、そのまま区間マークで追加先プレイリストに区間を登録できます。プレイリストに追加した動画も自動でライブラリに入ります。

### キーボード（デスクトップ）

| キー | 動作 |
|---|---|
| Space / → / ← | 再生停止 / 次 / 前 |
| Command(Ctrl) + [ / ] | 開始点 / 終了点 = 現在位置 |
| Command(Ctrl) + Enter | マークした区間をクリップとして追加 |
| Command(Ctrl) + N / L | 新規プレイリスト / URL 入力欄 |
| Command(Ctrl) + Shift + M / T / L | ミニプレーヤー / 常に最前面 / ライブラリ |
| Command + , （Windows: Ctrl + ,） | 設定 |
| メディアキー | 前 / 再生停止 / 次（macOS はアクセシビリティの許可が必要） |

### スマホで使う（外出先・SIM 回線）

AWS（Lambda の関数 URL + S3）に置いた画面を、スマホのブラウザで開きます。再生も編集（区間の編集・有効 / 無効など）もできます。

- Mac のアプリは、プレイリストとライブラリが変わるたびに、約 3 秒後に AWS へ送ります（送り先と書き込み用の鍵はデータフォルダの `cloud.json`）
- スマホの画面は、開いている間 5 秒ごとに変更を確かめます。Mac で保存してからスマホに出るまで、およそ 5〜10 秒です
- スマホで編集すると AWS に保存され、Mac のアプリが 5 秒ごとに確かめて取り込みます（およそ 2〜5 秒で Mac に届きます）
- URL に合言葉が入っており、合言葉を知らない人には何も見せず、書き込みもさせません
- 画面や Lambda のコードを直したら `bash scripts/deploy-cloud.sh` で AWS 側を更新します（合言葉と鍵は `cloud/.deploy.json`。Git に含めない）

### スマホで使う（同じ Wi-Fi）

1. デスクトップ版の設定で「スマホ連携（同じ Wi-Fi に公開）」を ON にします
2. 表示された URL（例 `http://192-168-1-23.nip.io:8787/`）をスマホのブラウザで開くか、QR コードを読み取ります。YouTube は IP アドレスのページ（`http://192.168.1.23:8787/`）に埋め込んだ動画を再生しないため、IP をそのまま返す DNS（nip.io）の名前で開きます。IP の URL で開いても自動でこの名前に移ります
3. 同じプレイリスト・ライブラリが使えます。再生はスマホ自身で行い、編集は双方に即時反映されます
4. ホーム画面に置くには、スマホの Chrome の ⋮ メニューから「ホーム画面に追加」を選びます。ShuffleTube のアイコンでショートカットができます（Chrome のタブで開きます）。設定画面に出る `http://<PCの名前>.local:8787/` の URL で追加すると、PC の IP が変わってもショートカットが切れません

認証はありません。同じ LAN 内からのみ見える前提で、使わないときは OFF にしてください。

## 開発

```bash
npm install
npm run dev        # 開発モード（renderer はホットリロード。main を変えたら再起動）
npm run typecheck
```

### ビルド

| 対象 | コマンド | 出力 |
|---|---|---|
| macOS | `npm run dist:mac` | `dist/*.dmg`, `dist/mac-arm64/ShuffleTube.app` |
| Windows | `npm run dist:win`（Windows 上、または macOS からのクロスビルド） | `dist/*.exe` |

GitHub Actions（`.github/workflows/build.yml`）で macOS / Windows を自動ビルドし、`v*` タグを push すると Release に成果物を添付します。

### 構成

```
src/main/      Electron main（ウィンドウ、メニュー、IPC、メディアキー、スリープ防止、JSON 保存、localhost 配信、LAN サーバー）
src/preload/   contextBridge（window.api）
src/renderer/  React UI（store.ts = zustand、player.ts = 再生制御、components/、webApi.ts = ブラウザ版、cloudApi.ts = クラウド版）
src/shared/    共有型・メタデータ取得ロジック
cloud/         クラウド版（AWS Lambda、未公開）
build/ assets/ アイコン
docs/          仕様書
```

### 仕組みメモ

- renderer は `file://` ではなく、本番では main プロセス内の `127.0.0.1` HTTP サーバーから配信します。`file://` だと YouTube 埋め込みが Referer 無しでエラー 153 になるためです
- 区間再生は 100 ms ごとに現在位置を監視して終了秒で止めます。`endSeconds` はシーク後に無効になるため使いません
- タイトル・投稿者は oEmbed、動画の長さは視聴ページの HTML から取得します（失敗しても再生時にプレーヤーから補完）
- 再生リスト URL の取り込みは、非表示プレーヤーに `list=` を読ませて `getPlaylist()` で動画 ID を得ています
- データの保存先: macOS `~/Library/Application Support/ShuffleTube/`、Windows `%APPDATA%\ShuffleTube\`（`playlists.json` / `library.json` / `history.json` / `settings.json`）

## ライセンス

[MIT](LICENSE) © 2026 tobisako

YouTube は Google LLC の商標です。このアプリは YouTube の公式埋め込みプレーヤーを利用する非公式のツールで、Google / YouTube とは無関係です。
