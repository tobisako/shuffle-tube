/**
 * クラウド版（AWS の Lambda から配信）の window.api 実装。再生専用。
 * データは Mac のアプリが送ったものを api/data（合言葉付き URL からの相対パス）で読むだけで、
 * スマホ側の変更（再生履歴など）はどこにも保存しない。設定は端末ごと（localStorage）。
 */
import type { Api, AppData, DataChange } from '@shared/types'
import { createWebApi } from './webApi'

/** 画面を開いている間に Mac 側の変更を確かめる間隔 */
const POLL_MS = 5_000

async function fetchData(): Promise<Omit<AppData, 'settings'>> {
  const r = await fetch('api/data', { cache: 'no-store' })
  if (!r.ok) throw new Error('データを読み込めません')
  return (await r.json()) as Omit<AppData, 'settings'>
}

export function createCloudApi(): Api {
  const web = createWebApi()
  return {
    ...web,
    async loadAll(): Promise<AppData> {
      const d = await fetchData()
      const settings = await web.saveSettings({})
      return { ...d, history: [], settings }
    },
    savePlaylists: async () => { /* 再生専用 */ },
    saveLibrary: async () => { /* 再生専用 */ },
    saveHistory: async () => { /* 再生専用 */ },
    fetchMeta: async () => null,
    importPlaylists: async () => null,
    /** Mac 側の変更を、画面を開いている間は 5 秒ごと、画面に戻ったときはすぐに取り込む */
    onDataChanged(cb: (change: DataChange) => void) {
      let version = ''
      let busy = false
      const check = async (): Promise<void> => {
        if (busy || document.visibilityState !== 'visible') return
        busy = true
        try {
          const r = await fetch('api/data' + (version ? `?v=${version}` : ''), { cache: 'no-store' })
          const v = r.headers.get('x-data-version') ?? ''
          if (r.status === 200) {
            const d = (await r.json()) as Omit<AppData, 'settings'>
            // 初回は起動時に読んだデータと同じなので、版だけ覚える
            if (version) {
              cb({ kind: 'playlists', data: d.playlists, clientId: 'cloud' })
              cb({ kind: 'library', data: d.library, clientId: 'cloud' })
            }
          }
          if (r.ok && v) version = v
        } catch { /* 次の機会に */ } finally { busy = false }
      }
      void check()
      const timer = window.setInterval(check, POLL_MS)
      const onVisible = (): void => { if (document.visibilityState === 'visible') void check() }
      document.addEventListener('visibilitychange', onVisible)
      return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
    },
    platform: 'cloud',
  }
}
