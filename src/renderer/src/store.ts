import { create } from 'zustand'
import { DEFAULT_SETTINGS, LIBRARY_ID, libraryClipId, type AppData, type Clip, type DataChange, type HistoryEntry, type LibraryVideo, type Playlist, type Settings } from '@shared/types'

export interface Marks { start: number | null; end: number | null }
export interface PlayingRef { playlistId: string; clipId: string }

export interface AppState {
  loaded: boolean
  playlists: Playlist[]
  settings: Settings
  history: HistoryEntry[]
  library: LibraryVideo[]
  playing: PlayingRef | null
  isPlaying: boolean
  playerReady: boolean
  currentTime: number
  marks: Marks
  sidebarTab: 'lists' | 'history'
  settingsOpen: boolean
  /** 区間エディタで編集中のクリップ。isNew = 「同じ動画から区間を追加」で作った直後（取り消しで削除） */
  editing: { playlistId: string; clipId: string; isNew: boolean; returnTo: string | null } | null
  /** プレーヤーに読み込まれている動画の長さ（秒）。不明なら 0 */
  duration: number
  toast: { msg: string; key: number } | null
  focusNameInput: number
  /** ブラウザ版・Android 版か（Electron でなければ true） */
  isWeb: boolean
  /** Android アプリ版か */
  isNative: boolean
  /** スマホ表示の下部タブ */
  mobileTab: 'playlist' | 'library' | 'history'
}

export const useStore = create<AppState>(() => ({
  loaded: false,
  playlists: [],
  settings: DEFAULT_SETTINGS,
  history: [],
  library: [],
  playing: null,
  isPlaying: false,
  playerReady: false,
  currentTime: 0,
  marks: { start: null, end: null },
  sidebarTab: 'lists',
  settingsOpen: false,
  editing: null,
  duration: 0,
  toast: null,
  focusNameInput: 0,
  isWeb: false,
  isNative: false,
  mobileTab: 'playlist',
}))

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

/* ---------- selectors ---------- */
export function getCurrentPlaylist(s: AppState): Playlist | null {
  return s.playlists.find(p => p.id === s.settings.currentPlaylistId) || s.playlists[0] || null
}

/** ライブラリ全体を 1 つの仮想プレイリストとして扱う（library の参照が変わるまでキャッシュ） */
let libPlCacheSrc: LibraryVideo[] | null = null
let libPlCache: Playlist | null = null
export function getLibraryPlaylist(s: AppState): Playlist {
  if (libPlCache && libPlCacheSrc === s.library) return libPlCache
  libPlCacheSrc = s.library
  libPlCache = {
    id: LIBRARY_ID,
    name: 'ライブラリ',
    // 表示順（新しい順）と同じ順で連続再生する
    items: s.library.slice().sort((a, b) => b.addedAt - a.addedAt).map(v => ({
      id: libraryClipId(v.videoId), videoId: v.videoId, title: v.title, author: v.author,
      start: 0, end: null, label: '', addedAt: v.addedAt, duration: v.duration,
    })),
  }
  return libPlCache
}

/** 実プレイリスト、または LIBRARY_ID なら仮想プレイリスト */
export function getPlaylistById(s: AppState, id: string): Playlist | null {
  if (id === LIBRARY_ID) return getLibraryPlaylist(s)
  return s.playlists.find(p => p.id === id) || null
}
export function getPlayingPlaylist(s: AppState): Playlist | null {
  return s.playing ? getPlaylistById(s, s.playing.playlistId) : null
}
export function getPlayingClip(s: AppState): Clip | null {
  const pl = getPlayingPlaylist(s)
  return pl && s.playing ? pl.items.find(c => c.id === s.playing!.clipId) || null : null
}

/* ---------- 初期化・永続化 ---------- */
export async function initStore(): Promise<void> {
  const data: AppData = await window.api.loadAll()
  let playlists = data.playlists
  if (!playlists.length) playlists = [{ id: uid(), name: 'マイプレイリスト', items: [] }]
  const settings = { ...DEFAULT_SETTINGS, ...data.settings }
  if (!playlists.some(p => p.id === settings.currentPlaylistId)) settings.currentPlaylistId = playlists[0].id
  // ライブラリ: 既存プレイリストの動画で未登録のものを取り込む（初回移行）
  const library = Array.isArray(data.library) ? data.library.slice() : []
  const known = new Set(library.map(v => v.videoId))
  let migrated = 0
  for (const c of playlists.flatMap(p => p.items)) {
    if (known.has(c.videoId)) continue
    known.add(c.videoId)
    library.push({ videoId: c.videoId, title: c.title, author: c.author, duration: c.duration ?? null, memo: '', addedAt: c.addedAt })
    migrated++
  }
  useStore.setState({ playlists, settings, history: data.history, library, loaded: true, isWeb: window.api.platform === 'web' || window.api.platform === 'android', isNative: window.api.platform === 'android', mobileTab: settings.view === 'library' ? 'library' : 'playlist' })
  if (settings.currentPlaylistId !== data.settings.currentPlaylistId) {
    window.api.saveSettings({ currentPlaylistId: settings.currentPlaylistId })
  }
  if (!data.playlists.length) window.api.savePlaylists(playlists)
  if (migrated) window.api.saveLibrary(library)
  window.api.onDataChanged(applyRemoteChange)
}

/** 他の端末からの変更を取り込む（自分の保存は subscribe 側で抑止する） */
let applyingRemote = false
export function applyRemoteChange(change: DataChange): void {
  const s = useStore.getState()
  applyingRemote = true
  try {
    if (change.kind === 'playlists' && Array.isArray(change.data)) {
      const playlists = change.data as Playlist[]
      const patch: Partial<AppState> = { playlists: playlists.length ? playlists : s.playlists }
      if (s.settings.currentPlaylistId && !playlists.some(p => p.id === s.settings.currentPlaylistId) && playlists.length) {
        patch.settings = { ...s.settings, currentPlaylistId: playlists[0].id }
      }
      if (s.editing && !playlists.some(p => p.items.some(c => c.id === s.editing!.clipId))) patch.editing = null
      useStore.setState(patch)
    } else if (change.kind === 'library' && Array.isArray(change.data)) {
      useStore.setState({ library: change.data as LibraryVideo[] })
    } else if (change.kind === 'history' && Array.isArray(change.data)) {
      useStore.setState({ history: change.data as HistoryEntry[] })
    }
  } finally {
    applyingRemote = false
  }
}

let plTimer: number | null = null
let hsTimer: number | null = null
let libTimer: number | null = null
useStore.subscribe((s, prev) => {
  if (!s.loaded || applyingRemote) return
  if (s.playlists !== prev.playlists) {
    if (plTimer) window.clearTimeout(plTimer)
    plTimer = window.setTimeout(() => { window.api.savePlaylists(useStore.getState().playlists) }, 300)
  }
  if (s.history !== prev.history) {
    if (hsTimer) window.clearTimeout(hsTimer)
    hsTimer = window.setTimeout(() => { window.api.saveHistory(useStore.getState().history) }, 300)
  }
  if (s.library !== prev.library) {
    if (libTimer) window.clearTimeout(libTimer)
    libTimer = window.setTimeout(() => { window.api.saveLibrary(useStore.getState().library) }, 300)
  }
})

/* ---------- actions ---------- */
export function updateSettings(patch: Partial<Settings>): void {
  const cur = useStore.getState().settings
  const changed = (Object.keys(patch) as (keyof Settings)[]).some(k => JSON.stringify(cur[k]) !== JSON.stringify(patch[k]))
  if (!changed) return
  useStore.setState({ settings: { ...cur, ...patch } })
  window.api.saveSettings(patch)
}

export function toast(msg: string): void {
  useStore.setState({ toast: { msg, key: Date.now() } })
}

export function setPlaylists(fn: (pls: Playlist[]) => Playlist[]): void {
  useStore.setState({ playlists: fn(useStore.getState().playlists) })
}

export function updatePlaylist(playlistId: string, fn: (pl: Playlist) => Playlist): void {
  setPlaylists(pls => pls.map(p => (p.id === playlistId ? fn(p) : p)))
}

export function updateClip(playlistId: string, clipId: string, patch: Partial<Clip>): void {
  updatePlaylist(playlistId, pl => ({ ...pl, items: pl.items.map(c => (c.id === clipId ? { ...c, ...patch } : c)) }))
}

/** 動画IDが一致する全クリップとライブラリのタイトル・投稿者・長さを埋める（空文字 / null は上書きしない） */
export function fillMeta(videoId: string, title: string, author: string, duration: number | null = null): void {
  const lib = useStore.getState().library
  if (lib.some(v => v.videoId === videoId && ((title && v.title !== title) || (author && v.author !== author) || (duration != null && v.duration !== duration)))) {
    useStore.setState({
      library: lib.map(v => v.videoId === videoId
        ? { ...v, title: title || v.title, author: author || v.author, duration: duration ?? v.duration }
        : v),
    })
  }
  setPlaylists(pls => pls.map(pl => {
    const need = pl.items.some(c => c.videoId === videoId && (
      (title && c.title !== title) || (author && c.author !== author) || (duration != null && c.duration !== duration) || c.error))
    if (!need) return pl
    return {
      ...pl,
      items: pl.items.map(c => {
        if (c.videoId !== videoId) return c
        const { error: _e, ...rest } = c
        return { ...rest, title: title || c.title, author: author || c.author, duration: duration ?? c.duration ?? null }
      }),
    }
  }))
}

export function makeClip(videoId: string, start: number | null, end: number | null, label = ''): Clip {
  return { id: uid(), videoId, title: '', author: '', start: start ?? 0, end, label, addedAt: Date.now(), duration: null }
}

/** クリップを追加。戻り値 = 実際に追加された数 */
export function addClips(playlistId: string, clips: Clip[], afterClipId: string | null = null): number {
  let added = 0
  updatePlaylist(playlistId, pl => {
    const fresh = clips.filter(c => !pl.items.some(x => x.videoId === c.videoId && x.start === c.start && x.end === c.end))
    added = fresh.length
    if (!fresh.length) return pl
    const items = pl.items.slice()
    const at = afterClipId ? items.findIndex(c => c.id === afterClipId) : -1
    if (at >= 0) items.splice(at + 1, 0, ...fresh)
    else items.push(...fresh)
    return { ...pl, items }
  })
  // ライブラリにも登録し、メタデータを取得（動画IDごとに1回）
  ensureInLibrary([...new Set(clips.map(c => c.videoId))])
  return added
}

/** ライブラリに未登録の動画を登録し、メタデータを取得する。戻り値 = 新規登録数 */
export function ensureInLibrary(videoIds: string[]): number {
  const s = useStore.getState()
  const have = new Set(s.library.map(v => v.videoId))
  const fresh = [...new Set(videoIds)].filter(id => !have.has(id))
  if (fresh.length) {
    const now = Date.now()
    const add: LibraryVideo[] = fresh.map((videoId, i) => {
      const k = s.playlists.flatMap(p => p.items).find(c => c.videoId === videoId && c.title)
      return { videoId, title: k?.title ?? '', author: k?.author ?? '', duration: k?.duration ?? null, memo: '', addedAt: now + i }
    })
    useStore.setState({ library: [...add, ...s.library] })
  }
  for (const id of [...new Set(videoIds)]) {
    const st = useStore.getState()
    const known = st.library.find(v => v.videoId === id && v.title && v.duration != null)
      || st.playlists.flatMap(p => p.items).find(c => c.videoId === id && c.title && c.duration != null)
    if (known) { fillMeta(id, known.title, known.author, known.duration ?? null); continue }
    window.api.fetchMeta(id).then(meta => { if (meta) fillMeta(id, meta.title, meta.author, meta.duration) })
  }
  return fresh.length
}

export function removeFromLibrary(videoId: string): void {
  useStore.setState({ library: useStore.getState().library.filter(v => v.videoId !== videoId) })
}

export function setLibraryMemo(videoId: string, memo: string): void {
  useStore.setState({ library: useStore.getState().library.map(v => (v.videoId === videoId ? { ...v, memo } : v)) })
}

/** 動画がいくつのクリップで使われているか */
export function usageCount(s: AppState, videoId: string): number {
  let n = 0
  for (const p of s.playlists) for (const c of p.items) if (c.videoId === videoId) n++
  return n
}

export function setView(view: 'playlist' | 'library'): void {
  updateSettings({ view })
  useStore.setState({ editing: null })
}

export function removeClip(playlistId: string, clipId: string): void {
  updatePlaylist(playlistId, pl => ({ ...pl, items: pl.items.filter(c => c.id !== clipId) }))
}

export function moveClip(playlistId: string, from: number, to: number): void {
  updatePlaylist(playlistId, pl => {
    if (from < 0 || from >= pl.items.length || to < 0 || to >= pl.items.length || from === to) return pl
    const items = pl.items.slice()
    const [c] = items.splice(from, 1)
    items.splice(to, 0, c)
    return { ...pl, items }
  })
}

export function newPlaylist(name?: string): Playlist {
  const n = useStore.getState().playlists.length + 1
  const pl: Playlist = { id: uid(), name: (name || '').trim() || `プレイリスト ${n}`, items: [] }
  setPlaylists(pls => [...pls, pl])
  updateSettings({ currentPlaylistId: pl.id, view: 'playlist' })
  return pl
}

export function renamePlaylist(playlistId: string, name: string): void {
  const v = name.trim()
  if (!v) return
  updatePlaylist(playlistId, pl => ({ ...pl, name: v }))
}

export function deletePlaylist(playlistId: string): void {
  let pls = useStore.getState().playlists.filter(p => p.id !== playlistId)
  if (!pls.length) pls = [{ id: uid(), name: 'マイプレイリスト', items: [] }]
  useStore.setState({ playlists: pls })
  updateSettings({ currentPlaylistId: pls[0].id })
}

export function clearPlaylist(playlistId: string): void {
  updatePlaylist(playlistId, pl => ({ ...pl, items: [] }))
}

export function switchPlaylist(playlistId: string): void {
  updateSettings({ currentPlaylistId: playlistId, view: 'playlist' })
  useStore.setState({ editing: null })
}

export function addHistory(entry: Omit<HistoryEntry, 'id' | 'playedAt'>): void {
  const s = useStore.getState()
  if (!s.settings.history) return
  const last = s.history[0]
  const now = Date.now()
  if (last && last.videoId === entry.videoId && last.start === entry.start && last.end === entry.end && now - last.playedAt < 60_000) return
  const next = [{ ...entry, id: uid(), playedAt: now }, ...s.history].slice(0, 500)
  useStore.setState({ history: next })
}

export function clearHistory(): void { useStore.setState({ history: [] }) }
export function removeHistory(id: string): void { useStore.setState({ history: useStore.getState().history.filter(h => h.id !== id) }) }

// 開発時のみ: 動作確認用にストアを公開
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore

/** Android 版: Mac から取り込んだデータでスマホ側を置き換える（保存もする） */
export function replaceSharedData(data: { playlists: Playlist[]; library: LibraryVideo[]; history: HistoryEntry[] }): void {
  const s = useStore.getState()
  const playlists = data.playlists.length ? data.playlists : [{ id: uid(), name: 'マイプレイリスト', items: [] }]
  const patch: Partial<AppState> = { playlists, library: data.library, history: data.history, editing: null }
  if (!playlists.some(p => p.id === s.settings.currentPlaylistId)) {
    patch.settings = { ...s.settings, currentPlaylistId: playlists[0].id }
    window.api.saveSettings({ currentPlaylistId: playlists[0].id })
  }
  useStore.setState(patch)
}
