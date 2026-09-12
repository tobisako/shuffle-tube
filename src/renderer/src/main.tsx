import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/app.css'
import { Capacitor } from '@capacitor/core'
import { createWebApi } from './webApi'
import { createNativeApi } from './nativeApi'

// Android アプリ（Capacitor）ならスマホ内保存の API、Electron の preload が無ければ LAN サーバー経由の API を使う
if (Capacitor.isNativePlatform()) window.api = createNativeApi()
else if (!window.api) window.api = createWebApi()
document.body.classList.add('platform-' + window.api.platform)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
