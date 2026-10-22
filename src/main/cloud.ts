import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { store } from './store'
import { subscribe } from './hub'
import type { DataKind } from '@shared/types'

/**
 * クラウド版（AWS）へのデータ送信。
 * scripts/deploy-cloud.sh がデータフォルダに cloud.json を書く。無ければ何もしない。
 *   { "baseUrl": "https://xxx.lambda-url.ap-northeast-1.on.aws/", "uploadKey": "...", "viewUrl": "https://.../<合言葉>/" }
 * プレイリストとライブラリが変わるたびに、少し待ってから丸ごと送る（履歴は送らない）。
 */
interface CloudConfig { baseUrl: string; uploadKey: string; viewUrl?: string }

function loadConfig(): CloudConfig | null {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'cloud.json'), 'utf8')) as Partial<CloudConfig>
    return c.baseUrl && c.uploadKey ? { baseUrl: c.baseUrl, uploadKey: c.uploadKey, viewUrl: c.viewUrl } : null
  } catch { return null }
}

const timers = new Map<DataKind, ReturnType<typeof setTimeout>>()

async function push(kind: 'playlists' | 'library'): Promise<void> {
  const cfg = loadConfig()
  if (!cfg) return
  const data = kind === 'playlists' ? store.loadPlaylists() : store.loadLibrary()
  try {
    const r = await fetch(new URL(`upload/${kind}`, cfg.baseUrl), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-upload-key': cfg.uploadKey },
      body: JSON.stringify(data),
    })
    if (!r.ok) console.warn(`[cloud] ${kind} の送信に失敗: HTTP ${r.status}`)
  } catch (e) {
    console.warn(`[cloud] ${kind} の送信に失敗`, e)
  }
}

function schedule(kind: 'playlists' | 'library', delayMs: number): void {
  const t = timers.get(kind)
  if (t) clearTimeout(t)
  timers.set(kind, setTimeout(() => { timers.delete(kind); void push(kind) }, delayMs))
}

/** 起動時に一度送り、以後は変更のたびに送る */
export function startCloudSync(): void {
  if (!loadConfig()) return
  schedule('playlists', 2000)
  schedule('library', 2000)
  subscribe(kind => {
    if (kind === 'playlists' || kind === 'library') schedule(kind, 3000)
  })
}
