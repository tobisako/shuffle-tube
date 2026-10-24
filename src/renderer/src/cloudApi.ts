/**
 * クラウド版（AWS の Lambda から配信）の window.api 実装。外出先のスマホで使う。
 * データは api/data（合言葉付き URL からの相対パス）で読み、編集したら api/playlists・api/library に保存する。
 * Mac のアプリが数秒ごとに AWS を確かめて、スマホでの編集を取り込む。
 * 再生履歴は保存しない。設定は端末ごと（localStorage）。
 */
import type { Api, AppData, DataChange } from '@shared/types'
import { createWebApi } from './webApi'

/** 画面を開いている間に Mac 側の変更を確かめる間隔 */
const POLL_MS = 5_000

/** いま画面にあるデータと一致している AWS の版（自分の保存を取り込み直さないため） */
let version = ''
/** 保存中・保存待ちの数（その間は Mac 側の変更を取り込まない。スマホ側のほうが新しい） */
let saving = 0

async function fetchData(): Promise<Omit<AppData, 'settings'>> {
  const r = await fetch('api/data', { cache: 'no-store' })
  if (!r.ok) throw new Error('データを読み込めません')
  version = r.headers.get('x-data-version') ?? ''
  return (await r.json()) as Omit<AppData, 'settings'>
}

/** 保存は 1 つずつ順に送る（後から送ったものが AWS に残るように） */
let queue: Promise<void> = Promise.resolve()
function save(kind: 'playlists' | 'library', data: unknown): Promise<void> {
  saving++
  const body = JSON.stringify(data)
  queue = queue.then(async () => {
    try {
      const r = await fetch(`api/${kind}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body })
      if (!r.ok) throw new Error(`保存に失敗しました（${r.status}）`)
      const v = r.headers.get('x-data-version')
      if (v) version = v
    } catch (e) {
      console.warn('[cloud] save failed', e)
    } finally {
      saving--
    }
  })
  return queue
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
    savePlaylists: data => save('playlists', data),
    saveLibrary: data => save('library', data),
    saveHistory: async () => { /* 履歴はこの端末の画面にだけ残す */ },
    fetchMeta: async () => null,
    /** Mac 側の変更を、画面を開いている間は 5 秒ごと、画面に戻ったときはすぐに取り込む */
    onDataChanged(cb: (change: DataChange) => void) {
      let busy = false
      const check = async (): Promise<void> => {
        if (busy || saving || document.visibilityState !== 'visible') return
        busy = true
        try {
          const r = await fetch('api/data' + (version ? `?v=${version}` : ''), { cache: 'no-store' })
          const v = r.headers.get('x-data-version') ?? ''
          // 問い合わせ中にこちらで保存していたら、その保存のほうが新しいので取り込まない
          if (r.status === 200 && !saving && v !== version) {
            const d = (await r.json()) as Omit<AppData, 'settings'>
            cb({ kind: 'playlists', data: d.playlists, clientId: 'cloud' })
            cb({ kind: 'library', data: d.library, clientId: 'cloud' })
            version = v
          }
        } catch { /* 次の機会に */ } finally { busy = false }
      }
      const timer = window.setInterval(check, POLL_MS)
      const onVisible = (): void => { if (document.visibilityState === 'visible') void check() }
      document.addEventListener('visibilitychange', onVisible)
      return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
    },
    platform: 'cloud',
  }
}
