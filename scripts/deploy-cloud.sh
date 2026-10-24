#!/bin/bash
# ShuffleTube クラウド版（外出先のスマホで再生だけする版）の画面と Lambda を更新する。
# AWS 側（S3 バケット・IAM ロール・Lambda・関数 URL）は 2026-10-23 に作成済み。ここでは中身だけを入れ替える。
#   - 画面ファイル: out/renderer を S3 の web/ に同期
#   - Lambda: cloud/lambda/index.mjs を差し替え
#
#   bash scripts/deploy-cloud.sh        （AWS_PROFILE の既定は gj-prod-master）
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_PROFILE="${AWS_PROFILE:-gj-prod-master}"
export AWS_REGION="${AWS_REGION:-ap-northeast-1}"
export AWS_PAGER=""
BUCKET="shuffletube-$(aws sts get-caller-identity --query Account --output text)-$AWS_REGION"
FUNC="shuffletube-cloud"

echo "== 画面をビルドして S3 に置く"
npm run build >/dev/null
aws s3 sync out/renderer "s3://$BUCKET/web/" --delete --only-show-errors

echo "== Lambda のコードを差し替える"
TMP=$(mktemp -d)
(cd cloud/lambda && zip -q "$TMP/fn.zip" index.mjs)
aws lambda update-function-code --function-name "$FUNC" --zip-file "fileb://$TMP/fn.zip" >/dev/null
aws lambda wait function-updated-v2 --function-name "$FUNC"
rm -rf "$TMP"
echo "完了"
