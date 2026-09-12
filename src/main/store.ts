import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type HistoryEntry, type LibraryVideo, type Playlist, type Settings } from '@shared/types'

const DATA_FILES = ['playlists.json', 'library.json', 'history.json', 'settings.json']
let migrated = false

function dataDir(): string {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  if (!migrated) {
    migrated = true
    migrateFromOldName(dir)
  }
  return dir
}

/** 旧名「YouTube PlayList」のデータフォルダがあり、新フォルダにデータが無ければコピーする（1 回だけ） */
function migrateFromOldName(dir: string): void {
  try {
    if (fs.existsSync(path.join(dir, 'playlists.json'))) return
    const old = path.join(app.getPath('appData'), 'YouTube PlayList')
    if (!fs.existsSync(path.join(old, 'playlists.json'))) return
    for (const f of DATA_FILES) {
      const src = path.join(old, f)
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f))
    }
    console.log('[store] 旧データフォルダから移行しました:', old)
  } catch (e) {
    console.warn('[store] 移行に失敗:', e)
  }
}

function readJson<T>(name: string, fallback: T): T {
  const file = path.join(dataDir(), name)
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch (e) {
    console.warn(`[store] ${name} の読み込みに失敗:`, e)
    try { fs.copyFileSync(file, file + '.broken') } catch { /* ignore */ }
    return fallback
  }
}

/** 一時ファイルに書いてから rename (書き込み途中のクラッシュで壊れないように) */
function writeJsonAtomic(name: string, data: unknown): void {
  const file = path.join(dataDir(), name)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

interface PlaylistsFile { version: number; playlists: Playlist[] }
interface HistoryFile { version: number; entries: HistoryEntry[] }
interface LibraryFile { version: number; videos: LibraryVideo[] }

export const store = {
  loadPlaylists(): Playlist[] {
    const f = readJson<PlaylistsFile>('playlists.json', { version: 1, playlists: [] })
    return Array.isArray(f.playlists) ? f.playlists : []
  },
  savePlaylists(playlists: Playlist[]): void {
    writeJsonAtomic('playlists.json', { version: 1, playlists })
  },
  loadSettings(): Settings {
    const s = readJson<Partial<Settings>>('settings.json', {})
    return { ...DEFAULT_SETTINGS, ...s }
  },
  saveSettings(settings: Settings): void {
    writeJsonAtomic('settings.json', settings)
  },
  loadHistory(): HistoryEntry[] {
    const f = readJson<HistoryFile>('history.json', { version: 1, entries: [] })
    return Array.isArray(f.entries) ? f.entries : []
  },
  saveHistory(entries: HistoryEntry[]): void {
    writeJsonAtomic('history.json', { version: 1, entries })
  },
  loadLibrary(): LibraryVideo[] {
    const f = readJson<LibraryFile>('library.json', { version: 1, videos: [] })
    return Array.isArray(f.videos) ? f.videos : []
  },
  saveLibrary(videos: LibraryVideo[]): void {
    writeJsonAtomic('library.json', { version: 1, videos })
  },
  dataDir,
}
