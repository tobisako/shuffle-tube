/** 共有型定義 (main / preload / renderer) */

export interface Clip {
  id: string
  videoId: string
  title: string
  author: string
  /** 開始秒 */
  start: number
  /** 終了秒。null = 最後まで */
  end: number | null
  /** 任意のメモ */
  label: string
  addedAt: number
  /** 動画の長さ（秒）。取得できていなければ null */
  duration?: number | null
  error?: string
}

export interface Playlist {
  id: string
  name: string
  items: Clip[]
}

/** ライブラリ（動画の保管庫）の 1 件 */
export interface LibraryVideo {
  videoId: string
  title: string
  author: string
  duration: number | null
  memo: string
  addedAt: number
}

/** ライブラリ全体を 1 つの仮想プレイリストとして再生するときの ID */
export const LIBRARY_ID = '__library__'
export const libraryClipId = (videoId: string): string => `lib:${videoId}`

export type LoopMode = 'off' | 'all' | 'one'

export interface Bounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface Settings {
  mediaKeys: boolean
  alwaysOnTop: boolean
  miniPlayer: boolean
  rememberVolume: boolean
  history: boolean
  preventSleep: boolean
  volume: number
  playbackRate: number
  shuffle: boolean
  loop: LoopMode
  currentPlaylistId: string | null
  last: { playlistId: string; clipId: string } | null
  windowBounds: Bounds | null
  /** メイン領域の表示 */
  view: 'playlist' | 'library'
  /** スマホ連携: 同じ Wi-Fi に HTTP サーバーを公開する */
  lanServer: boolean
  lanPort: number
  /** Android 版: 同期先の Mac の URL（例 http://192.168.1.23:8787/） */
  macUrl: string
}

export const DEFAULT_SETTINGS: Settings = {
  mediaKeys: true,
  alwaysOnTop: false,
  miniPlayer: false,
  rememberVolume: true,
  history: true,
  preventSleep: true,
  volume: 100,
  playbackRate: 1,
  shuffle: false,
  loop: 'off',
  currentPlaylistId: null,
  last: null,
  windowBounds: null,
  view: 'playlist',
  lanServer: false,
  lanPort: 8787,
  macUrl: '',
}

export interface HistoryEntry {
  id: string
  videoId: string
  title: string
  author: string
  start: number
  end: number | null
  playedAt: number
}

export interface VideoMeta {
  title: string
  author: string
  /** 動画の長さ（秒）。取れなければ null */
  duration: number | null
}

export interface MediaKeysStatus {
  /** 3つのメディアキーを全て登録できたか */
  registered: boolean
  /** macOS のアクセシビリティ許可があるか */
  trusted: boolean
}

/** 共有データの変更通知（Mac ⇄ スマホ） */
export type DataKind = 'playlists' | 'library' | 'history'
export interface DataChange {
  kind: DataKind
  data: unknown
  /** 変更元クライアントの ID（自分の変更の echo を無視するため） */
  clientId: string
}

export interface LanInfo {
  enabled: boolean
  /** 実際に待ち受けているポート（0 = 停止中） */
  port: number
  urls: string[]
  error?: string
  /** Android 版 APK を /app.apk で配信できるか */
  apk?: boolean
}

export interface AppData {
  playlists: Playlist[]
  settings: Settings
  history: HistoryEntry[]
  library: LibraryVideo[]
}

/** main → renderer のコマンド (メニュー / メディアキー) */
export type Command =
  | 'play-pause'
  | 'next'
  | 'prev'
  | 'new-playlist'
  | 'focus-url'
  | 'toggle-mini'
  | 'toggle-top'
  | 'toggle-shuffle'
  | 'cycle-loop'
  | 'settings'
  | 'export'
  | 'import'
  | 'mark-start'
  | 'mark-end'
  | 'add-clip'
  | 'show-library'

/** preload が window.api として公開する API */
export interface Api {
  loadAll(): Promise<AppData>
  savePlaylists(playlists: Playlist[]): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  saveHistory(history: HistoryEntry[]): Promise<void>
  saveLibrary(videos: LibraryVideo[]): Promise<void>
  fetchMeta(videoId: string): Promise<VideoMeta | null>
  setPlaybackState(isPlaying: boolean): void
  exportPlaylists(json: string, suggestedName: string): Promise<boolean>
  importPlaylists(): Promise<string | null>
  openExternal(url: string): void
  mediaKeysStatus(): Promise<MediaKeysStatus>
  requestAccessibility(): Promise<MediaKeysStatus>
  onCommand(cb: (cmd: Command) => void): () => void
  /** 他の端末（スマホなど）からの変更を受け取る */
  onDataChanged(cb: (change: DataChange) => void): () => void
  lanInfo(): Promise<LanInfo>
  /** Android 版: Mac の LAN サーバーとの明示同期（CORS の制約が無いネイティブ HTTP で行う） */
  remote?: {
    fetchData(baseUrl: string): Promise<SharedData>
    pushData(baseUrl: string, data: SharedData): Promise<void>
  }
  platform: string
}

/** 端末間で共有するデータ（設定は含まない） */
export interface SharedData {
  playlists: Playlist[]
  library: LibraryVideo[]
  history: HistoryEntry[]
}
