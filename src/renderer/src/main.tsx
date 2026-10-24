import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/app.css'
import { createWebApi } from './webApi'
import { createCloudApi } from './cloudApi'
import { initTooltips } from './tooltip'

// ブラウザ版を IP アドレス（http://192.168.0.5:8787/ など）で開いたら、同じ PC を指す nip.io の名前に移る。
// YouTube は IP アドレスのページに埋め込んだ動画の再生を拒否する（エラー 150）ため
const ipHost = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(location.hostname)
if (ipHost && !window.api) {
  location.replace(`${location.protocol}//${ipHost.slice(1).join('-')}.nip.io${location.port ? ':' + location.port : ''}${location.pathname}${location.search}${location.hash}`)
}

// AWS から配信されたクラウド版なら再生専用の API、Electron の preload が無ければ LAN サーバー経由の API を使う
if ((window as unknown as { __SHUFFLETUBE_CLOUD__?: boolean }).__SHUFFLETUBE_CLOUD__) window.api = createCloudApi()
else if (!window.api) window.api = createWebApi()
document.body.classList.add('platform-' + window.api.platform)
initTooltips()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
