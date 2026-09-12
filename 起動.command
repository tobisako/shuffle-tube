#!/bin/bash
# ShuffleTube（macOS）を起動する。
#  - ビルド済みの .app があればそれを開く
#  - 無ければ開発モード (npm run dev) で起動する
cd "$(dirname "$0")"
APP="dist/mac-arm64/ShuffleTube.app"
if [ -d "$APP" ]; then
  open "$APP"
else
  echo "ビルド済みアプリが無いので開発モードで起動します（初回は npm install が必要）"
  [ -d node_modules ] || npm install
  npm run dev
fi
