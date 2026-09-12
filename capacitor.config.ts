import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'jp.tobisako.shuffletube',
  appName: 'ShuffleTube',
  webDir: 'out/renderer',
  server: {
    // https://localhost/ から読み込む（YouTube 埋め込みに Referer と secure context が必要）
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    // WebView を Chrome の chrome://inspect からデバッグできるようにする（エミュレータでの動作確認用）
    webContentsDebuggingEnabled: true,
  },
}

export default config
