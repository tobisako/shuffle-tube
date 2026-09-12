/**
 * Android アプリ版（Capacitor）の window.api 実装。
 * データはスマホ内のファイル（Directory.Data）に保存し、Mac が無くても動く。
 * Mac との同期は設定画面からの明示操作（remote.fetchData / pushData）だけ。
 */
import { CapacitorHttp } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Browser } from '@capacitor/browser'
import { Share } from '@capacitor/share'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { DEFAULT_SETTINGS, type Api, type AppData, type HistoryEntry, type LibraryVideo, type Playlist, type Settings, type SharedData } from '@shared/types'
import { fetchMetaWith, type HttpFns } from '@shared/metaParse'

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const r = await Filesystem.readFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8 })
    const text = typeof r.data === 'string' ? r.data : await (r.data as Blob).text()
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

async function writeJson(name: string, data: unknown): Promise<void> {
  await Filesystem.writeFile({ path: name, directory: Directory.Data, data: JSON.stringify(data), encoding: Encoding.UTF8, recursive: true })
}

const http: HttpFns = {
  async fetchJson(url) {
    try {
      const r = await CapacitorHttp.get({ url, responseType: 'json', connectTimeout: 10000, readTimeout: 10000 })
      return r.status >= 200 && r.status < 300 ? r.data : null
    } catch { return null }
  },
  async fetchText(url, headers) {
    try {
      const r = await CapacitorHttp.get({ url, headers, responseType: 'text', connectTimeout: 10000, readTimeout: 15000 })
      return r.status >= 200 && r.status < 300 ? String(r.data) : null
    } catch { return null }
  },
}

const norm = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '') + '/'

export function createNativeApi(): Api {
  let settings: Settings = { ...DEFAULT_SETTINGS }
  let playing = false
  return {
    async loadAll(): Promise<AppData> {
      const [pl, lib, hist, st] = await Promise.all([
        readJson<{ playlists?: Playlist[] }>('playlists.json', {}),
        readJson<{ videos?: LibraryVideo[] }>('library.json', {}),
        readJson<{ entries?: HistoryEntry[] }>('history.json', {}),
        readJson<Partial<Settings>>('settings.json', {}),
      ])
      settings = { ...DEFAULT_SETTINGS, ...st }
      return {
        playlists: Array.isArray(pl.playlists) ? pl.playlists : [],
        library: Array.isArray(lib.videos) ? lib.videos : [],
        history: Array.isArray(hist.entries) ? hist.entries : [],
        settings,
      }
    },
    savePlaylists: (playlists) => writeJson('playlists.json', { version: 1, playlists }),
    saveLibrary: (videos) => writeJson('library.json', { version: 1, videos }),
    saveHistory: (entries) => writeJson('history.json', { version: 1, entries }),
    async saveSettings(patch) {
      settings = { ...settings, ...patch }
      await writeJson('settings.json', settings)
      if ('preventSleep' in patch) applyAwake(playing && settings.preventSleep)
      return settings
    },
    fetchMeta: (videoId) => fetchMetaWith(http, videoId),
    setPlaybackState(isPlaying) {
      playing = isPlaying
      applyAwake(isPlaying && settings.preventSleep)
    },
    async exportPlaylists(json, suggestedName) {
      try {
        await Filesystem.writeFile({ path: suggestedName, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
        const { uri } = await Filesystem.getUri({ path: suggestedName, directory: Directory.Cache })
        await Share.share({ title: suggestedName, files: [uri] })
        return true
      } catch {
        return false
      }
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
    openExternal(url) { Browser.open({ url }).catch(() => window.open(url, '_blank')) },
    mediaKeysStatus: async () => ({ registered: false, trusted: true }),
    requestAccessibility: async () => ({ registered: false, trusted: true }),
    onCommand: () => () => { /* メニューは無い */ },
    onDataChanged: () => () => { /* サーバー連携は明示同期のみ */ },
    lanInfo: async () => ({ enabled: false, port: 0, urls: [] }),
    remote: {
      async fetchData(baseUrl) {
        const r = await CapacitorHttp.get({ url: norm(baseUrl) + 'api/data', responseType: 'json', connectTimeout: 8000, readTimeout: 15000 })
        if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`)
        const d = r.data as Partial<SharedData>
        if (!d || !Array.isArray(d.playlists)) throw new Error('応答の形式が違います')
        return { playlists: d.playlists, library: Array.isArray(d.library) ? d.library : [], history: Array.isArray(d.history) ? d.history : [] }
      },
      async pushData(baseUrl, data) {
        const base = norm(baseUrl)
        for (const [path, body] of [['api/playlists', data.playlists], ['api/library', data.library], ['api/history', data.history]] as const) {
          const r = await CapacitorHttp.put({ url: base + path, headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'android' }, data: body, connectTimeout: 8000, readTimeout: 15000 })
          if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} (${path})`)
        }
      },
    },
    platform: 'android',
  }
}

let awake = false
function applyAwake(on: boolean): void {
  if (on === awake) return
  awake = on
  ;(on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => { awake = false })
}
