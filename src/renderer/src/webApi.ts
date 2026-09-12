/**
 * ブラウザ（スマホ）版の window.api 実装。
 * Electron の preload の代わりに、Mac 上の LAN サーバー（/api/...）と通信する。
 * 設定は端末ごと（localStorage）。プレイリスト・ライブラリ・履歴は Mac が正。
 */
import { DEFAULT_SETTINGS, type Api, type AppData, type DataChange, type Settings } from '@shared/types'

const SETTINGS_KEY = 'ytpl.web.settings.v1'
const CLIENT_ID = 'web-' + Math.random().toString(36).slice(2, 10)

function loadLocalSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}
function saveLocalSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

async function put(path: string, body: unknown): Promise<void> {
  const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
}

/* 画面ロック防止（Wake Lock API）。再生中だけ保持する */
let wakeLock: { release(): Promise<void> } | null = null
async function setWakeLock(on: boolean): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }
  if (!nav.wakeLock) return
  try {
    if (on && !wakeLock) wakeLock = await nav.wakeLock.request('screen')
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null }
  } catch { wakeLock = null }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') wakeLock = null })

export function createWebApi(): Api {
  let settings = loadLocalSettings()
  let playing = false
  return {
    async loadAll(): Promise<AppData> {
      const r = await fetch('/api/data', { cache: 'no-store' })
      if (!r.ok) throw new Error('サーバーに接続できません')
      const d = (await r.json()) as Omit<AppData, 'settings'>
      return { ...d, settings }
    },
    savePlaylists: (playlists) => put('/api/playlists', playlists),
    saveLibrary: (videos) => put('/api/library', videos),
    saveHistory: (history) => put('/api/history', history),
    async saveSettings(patch) {
      settings = { ...settings, ...patch }
      saveLocalSettings(settings)
      if ('preventSleep' in patch) setWakeLock(playing && settings.preventSleep)
      return settings
    },
    async fetchMeta(videoId) {
      try {
        const r = await fetch(`/api/meta/${videoId}`)
        return r.ok ? await r.json() : null
      } catch { return null }
    },
    setPlaybackState(isPlaying) {
      playing = isPlaying
      setWakeLock(isPlaying && settings.preventSleep)
    },
    async exportPlaylists(json, suggestedName) {
      const blob = new Blob([json], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = suggestedName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      return true
    },
    importPlaylists() {
      return new Promise<string | null>(resolve => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json,.json'
        input.onchange = () => {
          const f = input.files?.[0]
          if (!f) { resolve(null); return }
          f.text().then(resolve, () => resolve(null))
        }
        input.oncancel = () => resolve(null)
        input.click()
      })
    },
    openExternal(url) { window.open(url, '_blank', 'noopener') },
    mediaKeysStatus: async () => ({ registered: false, trusted: true }),
    requestAccessibility: async () => ({ registered: false, trusted: true }),
    onCommand: () => () => { /* ブラウザ版にメニューは無い */ },
    onDataChanged(cb) {
      let es: EventSource | null = null
      let closed = false
      const open = (): void => {
        if (closed) return
        es = new EventSource('/api/events')
        es.addEventListener('change', (e) => {
          try {
            const change = JSON.parse((e as MessageEvent).data) as DataChange
            if (change.clientId !== CLIENT_ID) cb(change)
          } catch { /* ignore */ }
        })
        es.onerror = () => { es?.close(); es = null; setTimeout(open, 3000) }
      }
      open()
      return () => { closed = true; es?.close() }
    },
    lanInfo: async () => ({ enabled: false, port: 0, urls: [] }),
    platform: 'web',
  }
}
