import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { store } from './store'
import { publish, subscribe } from './hub'
import type { LibraryVideo, Playlist } from '@shared/types'

/**
 * クラウド版（AWS）との同期。データフォルダに cloud.json が無ければ何もしない。
 *   { "baseUrl": "https://xxx.lambda-url.ap-northeast-1.on.aws/", "uploadKey": "...", "viewUrl": "https://.../<合言葉>/" }
 *
 * - Mac → AWS: プレイリストとライブラリが変わるたびに、3 秒待ってから丸ごと送る（履歴は送らない）
 * - AWS → Mac: 5 秒ごとに AWS の版を確かめ、スマホで編集されていれば取り込む（Mac 側に送っていない変更があるときは待つ）
 * - 起動時: 前回同期した時点の版とデータを cloud-sync.json に覚えておき、どちらが変わったかで送るか取り込むかを決める。
 *   両方が変わっていたらスマホ側を取り込み、Mac 側のデータは playlists.json.cloud-backup-<日時> に残す
 */
interface CloudConfig { baseUrl: string; uploadKey: string; viewUrl?: string }
interface SyncState { version: string; localHash: string }

const CLOUD_CLIENT = 'cloud'
const POLL_MS = 5000
const dataDir = (): string => app.getPath('userData')

function loadConfig(): CloudConfig | null {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dataDir(), 'cloud.json'), 'utf8')) as Partial<CloudConfig>
    return c.baseUrl && c.uploadKey ? { baseUrl: c.baseUrl, uploadKey: c.uploadKey, viewUrl: c.viewUrl } : null
  } catch { return null }
}

function loadState(): SyncState | null {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir(), 'cloud-sync.json'), 'utf8')) as SyncState } catch { return null }
}

const localHash = (): string =>
  createHash('sha1').update(JSON.stringify({ playlists: store.loadPlaylists(), library: store.loadLibrary() })).digest('hex')

/** AWS のこの版と、いまの Mac のデータが一致していると覚える */
let knownVersion = ''
function rememberSynced(version: string): void {
  knownVersion = version
  try { fs.writeFileSync(path.join(dataDir(), 'cloud-sync.json'), JSON.stringify({ version, localHash: localHash() })) } catch { /* ignore */ }
}

const timers = new Map<'playlists' | 'library', ReturnType<typeof setTimeout>>()
let pushing = 0

async function push(kind: 'playlists' | 'library'): Promise<void> {
  const cfg = loadConfig()
  if (!cfg) return
  const data = kind === 'playlists' ? store.loadPlaylists() : store.loadLibrary()
  pushing++
  try {
    const r = await fetch(new URL(`upload/${kind}`, cfg.baseUrl), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-upload-key': cfg.uploadKey },
      body: JSON.stringify(data),
    })
    if (!r.ok) { console.warn(`[cloud] ${kind} の送信に失敗: HTTP ${r.status}`); return }
    // まだ送る予定の変更が無ければ、この版を「Mac と一致」として覚える
    const v = r.headers.get('x-data-version')
    if (v && !timers.size) rememberSynced(v)
  } catch (e) {
    console.warn(`[cloud] ${kind} の送信に失敗`, e)
  } finally {
    pushing--
  }
}

function schedule(kind: 'playlists' | 'library', delayMs: number): void {
  const t = timers.get(kind)
  if (t) clearTimeout(t)
  timers.set(kind, setTimeout(() => { timers.delete(kind); void push(kind) }, delayMs))
}

interface RemoteData { version: string; playlists: Playlist[]; library: LibraryVideo[] }

async function fetchRemote(since: string): Promise<RemoteData | null | 'unchanged'> {
  const cfg = loadConfig()
  if (!cfg?.viewUrl) return null
  const r = await fetch(new URL('api/data' + (since ? `?v=${since}` : ''), cfg.viewUrl), { cache: 'no-store' })
  if (r.status === 204) return 'unchanged'
  if (!r.ok) return null
  const d = (await r.json()) as { playlists?: Playlist[]; library?: LibraryVideo[] }
  return { version: r.headers.get('x-data-version') ?? '', playlists: d.playlists ?? [], library: d.library ?? [] }
}

/** スマホで編集されたデータを Mac に取り込む（画面と LAN のスマホにも配る） */
function applyRemote(d: RemoteData): void {
  if (JSON.stringify(d.playlists) !== JSON.stringify(store.loadPlaylists())) publish('playlists', d.playlists, CLOUD_CLIENT)
  if (JSON.stringify(d.library) !== JSON.stringify(store.loadLibrary())) publish('library', d.library, CLOUD_CLIENT)
  rememberSynced(d.version)
}

async function poll(): Promise<void> {
  // Mac 側にまだ送っていない変更があるときは、送り終わるまで取り込まない（Mac 側のほうが新しい）
  if (timers.size || pushing) return
  try {
    const d = await fetchRemote(knownVersion)
    if (!d || d === 'unchanged' || timers.size || pushing) return
    if (d.version && d.version !== knownVersion) applyRemote(d)
  } catch { /* 次の機会に */ }
}

/** 起動時: 前回の同期から、どちらが変わったかで送るか取り込むかを決める */
async function initialSync(): Promise<void> {
  const saved = loadState()
  let remote: RemoteData | null = null
  try { const d = await fetchRemote(''); remote = d && d !== 'unchanged' ? d : null } catch { /* オフライン */ }
  if (!remote || !saved) { schedule('playlists', 0); schedule('library', 0); return }
  const remoteChanged = remote.version !== saved.version
  const localChanged = localHash() !== saved.localHash
  if (remoteChanged && localChanged) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      fs.copyFileSync(path.join(dataDir(), 'playlists.json'), path.join(dataDir(), `playlists.json.cloud-backup-${stamp}`))
    } catch { /* ignore */ }
  }
  if (remoteChanged) applyRemote(remote)
  else if (localChanged) { knownVersion = remote.version; schedule('playlists', 0); schedule('library', 0) }
  else knownVersion = remote.version
}

export function startCloudSync(): void {
  if (!loadConfig()) return
  subscribe((kind, _data, clientId) => {
    if (clientId === CLOUD_CLIENT) return
    if (kind === 'playlists' || kind === 'library') schedule(kind, 3000)
  })
  void initialSync().finally(() => { setInterval(() => { void poll() }, POLL_MS) })
}
