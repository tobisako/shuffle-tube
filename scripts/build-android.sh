#!/usr/bin/env bash
# Android 版 APK をビルドして dist/ShuffleTube.apk に置く。
# 必要: JDK 21、Android SDK（platforms;android-36、build-tools）。
# JAVA_HOME / ANDROID_HOME が未設定なら、よくある場所を探す。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${JAVA_HOME:-}" ]; then
  for c in /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/temurin-21-jdk-amd64; do
    [ -d "$c" ] && export JAVA_HOME="$c" && break
  done
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  for c in "$HOME/Library/Android/sdk" /opt/homebrew/share/android-commandlinetools "$HOME/Android/Sdk" "${LOCALAPPDATA:-}/Android/Sdk"; do
    [ -d "$c" ] && export ANDROID_HOME="$c" && break
  done
fi
[ -n "${JAVA_HOME:-}" ] || { echo "JAVA_HOME が見つかりません（JDK 21 を入れて JAVA_HOME を設定してください）"; exit 1; }
[ -n "${ANDROID_HOME:-}" ] || { echo "ANDROID_HOME が見つかりません（Android SDK を入れて ANDROID_HOME を設定してください）"; exit 1; }
echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_HOME=$ANDROID_HOME"
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

npx electron-vite build
npx cap sync android
if [ -f android/keystore.properties ]; then
  (cd android && ./gradlew assembleRelease --console=plain -q)
  SRC=android/app/build/outputs/apk/release/app-release.apk
else
  echo "android/keystore.properties が無いので debug 署名でビルドします（配布には release 署名を推奨）"
  (cd android && ./gradlew assembleDebug --console=plain -q)
  SRC=android/app/build/outputs/apk/debug/app-debug.apk
fi
mkdir -p dist
cp "$SRC" dist/ShuffleTube.apk
ls -la dist/ShuffleTube.apk
