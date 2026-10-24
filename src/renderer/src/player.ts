/**
 * プレーヤー制御（モジュール単位のシングルトン）
 *  - YouTube IFrame Player を1つだけ生成し、React ツリーの外で管理する
 *  - 区間再生: 100ms ごとに現在位置を監視し、終了秒で次のクリップへ
 */
import type { Clip, Segment } from '@shared/types'
import { allDisabled, firstStart, playSegmentsOf, segmentsOf } from './segments'
import { addClips, addHistory, fillMeta, getPlayingClip, getPlayingPlaylist, getPlaylistById, removeClip, toast, updateClip, updatePlaylist, updateSettings, useStore, type PlayingRef } from './store'
import { loadYT, type YTNamespace, type YTPlayer } from './youtube'
import { fmtTime, round1 } from './time'
import { uid } from './store'

const trace = (...a: unknown[]): void => {
  if (!import.meta.env.DEV) return
  const w = window as unknown as { __trace?: unknown[][] }
  ;(w.__trace ||= []).push([Date.now(), ...a])
}

let yt: YTNamespace | null = null
let player: YTPlayer | null = null
let ready = false
let loadedVideoId: string | null = null
let pendingPlay: PlayingRef | null = null
let historyStack: string[] = []
const playedSet = new Set<string>()
let watchdog: number | null = null
let clipEndedFired = false
/** 再生中のクリップの何番目の区間を流しているか */
let segIndex = 0
/** 最後の区間より後ろへ移動されたとき: 区間の終わりで止めず、動画の最後まで流す */
let freePlay = false
/** 前回の監視で読んだ再生位置（バーのクリックなどで位置が飛んだかを見る） */
let lastTickT = -1

/**
 * 再生位置 t に合わせて、どの区間を流すかを決め直す（バーのクリックや YouTube 側のシークバーで位置が飛んだとき）。
 * 区間の中ならその区間、区間の間なら次の区間（その終わりまで流す）、最後の区間より後ろなら動画の最後まで
 */
function syncSegToTime(clip: Clip, t: number): void {
  const segs = playSegmentsOf(clip)
  const inside = segs.findIndex(g => t >= g.start - 0.3 && (g.end == null || t < g.end - 0.05))
  if (inside >= 0) { segIndex = inside; freePlay = false; return }
  let next = -1
  for (let i = 0; i < segs.length; i++) if (segs[i].start > t && (next < 0 || segs[i].start < segs[next].start)) next = i
  if (next >= 0) { segIndex = next; freePlay = false } else freePlay = true
}

/**
 * いま再生の対象になっている区間。区間エディタで編集中はその区間だけを繰り返す（無効の区間でも）。
 * それ以外は、無効の区間を除いた中の segIndex 番目（1 つ目から順に続けて再生する）
 */
function currentSeg(clip: Clip): Segment {
  const ed = useStore.getState().editing
  if (ed && ed.clipId === clip.id) { const all = segmentsOf(clip); return all[ed.seg] ?? all[0] }
  const segs = playSegmentsOf(clip)
  return segs[segIndex] ?? segs[0]
}
let hasPlayedThisLoad = false
let loadToken = 0
let historyRecordedToken = -1
let consecutiveErrors = 0
let lastUiTime = -1
let volumeSyncAfter = 0
let lastVolumePoll = 0
let lastVolumeSeen = -1
let pauseAfterPlaying = false
let unmuteOnPlay = false
let scrubbing = false
let pendingSeek: number | null = null
let lastDuration = 0
let playerContainer: HTMLElement | null = null
let playerCreatedAt = 0
let lastErrorRefresh = { clipId: '', at: 0 }

/**
 * YouTube の埋め込みプレーヤーは、長く使い続けると古い版のまま残り、YouTube に再生を拒否される
 * （2026-10 に約 3 週間つけっぱなしで「エラーコード 152-18」が多発し、作り直すと直った）。
 * 作成からこの時間がたったら、別の動画を読み込む前にプレーヤーを作り直す。
 */
const PLAYER_MAX_AGE_MS = 4 * 60 * 60 * 1000
/** 作り直しても直らない（動画側の理由の）エラー: 不正な ID / 見つからない / 埋め込み禁止 */
const PERMANENT_ERRORS = new Set([2, 100, 101, 150])

/* ---------- 生成 ---------- */
export async function mountPlayer(container: HTMLElement): Promise<void> {
  if (player || container.dataset.mounted) return
  container.dataset.mounted = '1'
  playerContainer = container
  try {
    yt = await loadYT()
  } catch (e) {
    toast((e as Error).message)
    return
  }
  createPlayer()
}

function createPlayer(): void {
  if (!yt || !playerContainer) return
  const inner = document.createElement('div')
  playerContainer.appendChild(inner)
  ready = false
  playerCreatedAt = Date.now()
  player = new yt.Player(inner, {
    width: '100%',
    height: '100%',
    playerVars: { rel: 0, playsinline: 1, modestbranding: 1, controls: 1, iv_load_policy: 3 },
    events: { onReady, onStateChange, onError, onPlaybackRateChange },
  })
}

/** YouTube プレーヤー（iframe）を作り直す。then があれば準備ができしだい、そのクリップを再生する */
function refreshPlayer(then: PlayingRef | null): void {
  trace('refreshPlayer', then)
  try { player?.destroy() } catch { /* ignore */ }
  player = null
  ready = false
  loadedVideoId = null
  pendingPlay = then
  if (playerContainer) playerContainer.replaceChildren()
  useStore.setState({ playerReady: false, isPlaying: false })
  window.api.setPlaybackState(false)
  createPlayer()
}

/** 作成から時間がたったプレーヤーか（別の動画を読み込む前に作り直す） */
function playerIsStale(): boolean {
  return !!player && ready && Date.now() - playerCreatedAt > PLAYER_MAX_AGE_MS
}

/** 開発時の動作確認用 */
if (import.meta.env.DEV) {
  ;(window as unknown as { __playerDebug: unknown }).__playerDebug = {
    refresh: () => refreshPlayer(useStore.getState().playing),
    simulateError: (code: number) => onError({ data: code }),
    age: () => Date.now() - playerCreatedAt,
    makeStale: () => { playerCreatedAt = Date.now() - PLAYER_MAX_AGE_MS - 1000 },
  }
}

function onReady(): void {
  ready = true
  useStore.setState({ playerReady: true })
  if (pendingPlay) {
    const p = pendingPlay
    pendingPlay = null
    play(p.playlistId, p.clipId)
    return
  }
  const s = useStore.getState()
  const last = s.settings.last
  if (last) {
    const pl = getPlaylistById(s, last.playlistId)
    const clip = pl?.items.find(c => c.id === last.clipId)
    if (pl && clip) {
      useStore.setState({ playing: { playlistId: pl.id, clipId: clip.id }, currentTime: firstStart(clip) })
      loadedVideoId = clip.videoId
      player!.cueVideoById({ videoId: clip.videoId, startSeconds: firstStart(clip) })
      startWatchdog()
    }
  }
}

function onStateChange(e: { data: number }): void {
  if (!yt || !player) return
  const S = yt.PlayerState
  trace('state', e.data)
  const active = e.data === S.PLAYING || e.data === S.BUFFERING
  useStore.setState({ isPlaying: active })
  if (e.data === S.UNSTARTED || e.data === S.BUFFERING) {
    const { settings } = useStore.getState()
    if (settings.rememberVolume) { try { player.setVolume(settings.volume) } catch { /* ignore */ } }
  }
  window.api.setPlaybackState(e.data === S.PLAYING)
  if (e.data === S.PLAYING) {
    consecutiveErrors = 0
    try { loadedVideoId = player.getVideoData().video_id || loadedVideoId } catch { /* ignore */ }
    if (pauseAfterPlaying) {
      // プレビュー用の「読み込んで止める」
      pauseAfterPlaying = false
      player.pauseVideo()
      if (pendingSeek != null) { player.seekTo(pendingSeek, true); pendingSeek = null }
      applyVolumeRate()
      fillTitleFromPlayer()
      return
    }
    onStartedPlaying()
  } else if (e.data === S.ENDED) {
    if (!clipEndedFired) { clipEndedFired = true; onClipEnded() }
  }
}

function onPlaybackRateChange(e: { data: number }): void {
  const s = useStore.getState()
  if (s.settings.rememberVolume && Number.isFinite(e.data)) updateSettings({ playbackRate: e.data })
}

function onError(e: { data: number }): void {
  trace('error', e.data)
  const msgs: Record<number, string> = {
    2: '動画IDが不正です',
    5: 'HTML5 プレーヤーのエラー',
    100: '動画が見つかりません（削除・非公開）',
    101: '埋め込み再生が許可されていません',
    150: '埋め込み再生が許可されていません',
    152: 'YouTube に再生を拒否されました (152)',
    153: '埋め込み元の情報が不足しています (153)',
  }
  const s = useStore.getState()
  const clip = getPlayingClip(s)
  // 動画側の理由でないエラーは、プレーヤーを作り直して同じクリップを 1 回だけ再試行する
  if (clip && s.playing && !PERMANENT_ERRORS.has(e.data) &&
      !(lastErrorRefresh.clipId === clip.id && Date.now() - lastErrorRefresh.at < 60_000)) {
    lastErrorRefresh = { clipId: clip.id, at: Date.now() }
    toast(`YouTube のプレーヤーを読み込み直して再試行します（エラー ${e.data}）`)
    refreshPlayer({ playlistId: s.playing.playlistId, clipId: clip.id })
    return
  }
  const msg = msgs[e.data] || `エラー (${e.data})`
  if (clip && s.playing) updateClip(s.playing.playlistId, clip.id, { error: msg })
  toast(`再生できません: ${clip ? clip.title || clip.videoId : ''}（${msg}）`)
  loadedVideoId = null
  useStore.setState({ isPlaying: false })
  window.api.setPlaybackState(false)
  consecutiveErrors++
  const pl = getPlayingPlaylist(s)
  if (!pl || consecutiveErrors >= pl.items.length) return
  const token = loadToken
  window.setTimeout(() => { if (loadToken === token && useStore.getState().playing) next() }, 1200)
}

/* ---------- 再生開始時の処理 ---------- */
function onStartedPlaying(): void {
  hasPlayedThisLoad = true
  applyVolumeRate()
  fillTitleFromPlayer()
  recordHistory()
}

/** 動画を読み込む直前: 音量を先に当て、再生が始まるまでミュートして最大音量が漏れないようにする */
function prepareVolumeForLoad(): void {
  if (!player) return
  const { settings } = useStore.getState()
  if (!settings.rememberVolume) return
  try {
    player.setVolume(settings.volume)
    if (!player.isMuted()) { player.mute(); unmuteOnPlay = true }
  } catch { /* ignore */ }
}

function applyVolumeRate(): void {
  if (!player) return
  const { settings } = useStore.getState()
  if (!settings.rememberVolume) return
  try {
    if (Math.round(player.getVolume()) !== Math.round(settings.volume)) player.setVolume(settings.volume)
    if (player.getPlaybackRate() !== settings.playbackRate) player.setPlaybackRate(settings.playbackRate)
    if (unmuteOnPlay) { unmuteOnPlay = false; player.unMute() }
  } catch { /* ignore */ }
  volumeSyncAfter = Date.now() + 1500
}

/** 音量スライダーから: プレーヤーの音量を変えて覚える（保存は動かし終わってから） */
let volumeSaveTimer: number | null = null
export function setVolume(v: number): void {
  const vol = Math.max(0, Math.min(100, Math.round(v)))
  const s = useStore.getState()
  useStore.setState({ settings: { ...s.settings, volume: vol } })
  if (volumeSaveTimer) window.clearTimeout(volumeSaveTimer)
  volumeSaveTimer = window.setTimeout(() => { window.api.saveSettings({ volume: useStore.getState().settings.volume }) }, 400)
  // 1秒ごとの音量の読み取りが、変更前の値で上書きしないようにする
  volumeSyncAfter = Date.now() + 1500
  lastVolumeSeen = vol
  if (!player) return
  try {
    player.setVolume(vol)
    if (vol > 0 && player.isMuted() && !unmuteOnPlay) player.unMute()
  } catch { /* ignore */ }
}

function fillTitleFromPlayer(): void {
  if (!player) return
  let d: { video_id?: string; title?: string; author?: string } | null = null
  try { d = player.getVideoData() } catch { return }
  if (!d || !d.video_id || !d.title) return
  fillMeta(d.video_id, d.title, d.author || '')
}

function recordHistory(): void {
  if (historyRecordedToken === loadToken) return
  historyRecordedToken = loadToken
  const s = useStore.getState()
  const clip = getPlayingClip(s)
  if (!clip) return
  addHistory({ videoId: clip.videoId, title: clip.title, author: clip.author, start: clip.start, end: clip.end })
}

/* ---------- 監視 ---------- */
function startWatchdog(): void {
  if (watchdog) return
  watchdog = window.setInterval(tick, 100)
}

function tick(): void {
  if (!player || !ready) return
  const s = useStore.getState()
  if (!s.playing) return
  const clip = getPlayingClip(s)
  if (!clip) return
  let t = 0
  try { t = player.getCurrentTime() } catch { return }
  if (!Number.isFinite(t)) return

  if (Math.abs(t - lastUiTime) >= 0.2) {
    lastUiTime = t
    useStore.setState({ currentTime: t })
  }

  // 動画の長さ
  let d = 0
  try { d = player.getDuration() } catch { /* ignore */ }
  if (d > 0 && Math.abs(d - lastDuration) > 0.01) {
    lastDuration = d
    useStore.setState({ duration: d })
    if (clip.duration == null || Math.abs(clip.duration - d) > 1) fillMeta(clip.videoId, '', '', d)
  }

  // 位置が飛んだ（バーのクリック・YouTube 側のシークバー）ら、流す区間を決め直す。編集中は選んでいる区間のまま
  const editingThis = !!(s.editing && s.editing.clipId === clip.id)
  if (!editingThis && hasPlayedThisLoad && !scrubbing && lastTickT >= 0 && Math.abs(t - lastTickT) > 1.5) {
    syncSegToTime(clip, t)
    clipEndedFired = false
  }
  lastTickT = t

  // 区間の終わりで止めた後、区間内に戻ったら終了判定を再び有効にする
  const seg = currentSeg(clip)
  if (clipEndedFired && seg.end != null && t < seg.end - 0.5) clipEndedFired = false

  // 編集中: 再生位置が開始バーより前に行ったら開始位置へ戻す（YouTube 側のシークバー操作を含む）
  if (s.editing && s.editing.clipId === clip.id && s.isPlaying && hasPlayedThisLoad && !scrubbing && t < seg.start - 0.3) {
    try { player.seekTo(seg.start, true) } catch { /* ignore */ }
    return
  }

  if (seg.end != null && !(freePlay && !editingThis) && !clipEndedFired && !scrubbing && hasPlayedThisLoad && s.isPlaying && t >= seg.start - 0.5 && t >= seg.end - 0.05) {
    clipEndedFired = true
    onClipEnded()
    return
  }

  // 音量の記憶（1秒ごと）
  const now = Date.now()
  if (s.settings.rememberVolume && hasPlayedThisLoad && now > volumeSyncAfter && now - lastVolumePoll > 1000) {
    lastVolumePoll = now
    try {
      const v = Math.round(player.getVolume())
      if (!player.isMuted() && Number.isFinite(v)) {
        // 一時的な値を拾わないよう、1秒おきに2回同じ値だったときだけ保存
        if (v === lastVolumeSeen && v !== Math.round(s.settings.volume)) updateSettings({ volume: v })
        lastVolumeSeen = v
      }
    } catch { /* ignore */ }
  }
}

/* ---------- クリップ終了 ---------- */
function onClipEnded(): void {
  trace('clipEnded')
  if (!player) return
  const s = useStore.getState()
  const clip = getPlayingClip(s)
  if (!clip || !s.playing) return
  if (s.editing && s.editing.clipId === clip.id) {
    // 区間エディタで編集中: 次へ進まず、選んでいる区間を繰り返し再生し続ける
    clipEndedFired = false
    player.seekTo(currentSeg(clip).start, true)
    player.playVideo()
    return
  }
  // 区間が複数あれば、次の区間へ続ける（無効の区間は飛ばす）
  const segs = playSegmentsOf(clip)
  freePlay = false
  if (segIndex < segs.length - 1) {
    segIndex++
    clipEndedFired = false
    player.seekTo(segs[segIndex].start, true)
    player.playVideo()
    return
  }
  if (s.settings.loop === 'one') {
    segIndex = 0
    clipEndedFired = false
    player.seekTo(firstStart(clip), true)
    player.playVideo()
    return
  }
  const nextRef = nextPlayRef()
  if (!nextRef) {
    try { if (clip.end != null) player.pauseVideo() } catch { /* ignore */ }
    useStore.setState({ isPlaying: false })
    window.api.setPlaybackState(false)
    return
  }
  play(nextRef.playlistId, nextRef.clipId)
}

/**
 * 次に再生するクリップ。リストの最後まで来たら、そのリストの「またいで再生」が ON なら、
 * 並び順で次にある ON のリストの先頭へ（リピート「全曲」なら最後の ON のリストの後は最初の ON のリストへ）
 */
function nextPlayRef(): PlayingRef | null {
  const s = useStore.getState()
  if (!s.playing) return null
  const inList = nextClipId()
  if (inList) return { playlistId: s.playing.playlistId, clipId: inList }
  const cur = s.playlists.find(p => p.id === s.playing!.playlistId)
  if (!cur?.chain) return wrapInList()
  const order = s.playlists
  const at = order.findIndex(p => p.id === cur.id)
  const after = [...order.slice(at + 1), ...(s.settings.loop === 'all' ? order.slice(0, at + 1) : [])]
  for (const p of after) {
    if (!p.chain) continue
    const playable = p.items.filter(c => !allDisabled(c))
    if (!playable.length) continue
    const first = s.settings.shuffle ? playable[Math.floor(Math.random() * playable.length)] : playable[0]
    return { playlistId: p.id, clipId: first.id }
  }
  return null
}

/** リストの中だけで、最後の次を決める（リピート「全曲」なら頭へ。シャッフルなら引き直す） */
function wrapInList(): PlayingRef | null {
  const s = useStore.getState()
  const pl = getPlayingPlaylist(s)
  if (!pl || !s.playing || s.settings.loop !== 'all') return null
  const cur = s.playing.clipId
  const ids = pl.items.filter(c => !allDisabled(c) || c.id === cur).map(c => c.id)
  if (s.settings.shuffle) {
    playedSet.clear()
    playedSet.add(cur)
    const cand = ids.filter(id => id !== cur)
    return { playlistId: pl.id, clipId: cand.length ? cand[Math.floor(Math.random() * cand.length)] : cur }
  }
  if (!ids.length || (ids[0] === cur && allDisabled(pl.items.find(c => c.id === cur)!))) return null
  return { playlistId: pl.id, clipId: ids[0] }
}

/** リストの中で次のクリップ（最後なら null。頭へ戻るかリストをまたぐかは nextPlayRef が決める） */
function nextClipId(): string | null {
  const s = useStore.getState()
  const pl = getPlayingPlaylist(s)
  if (!pl || !pl.items.length || !s.playing) return null
  // 区間が全部無効の曲は連続再生で飛ばす
  const ids = pl.items.filter(c => !allDisabled(c) || c.id === s.playing!.clipId).map(c => c.id)
  const cur = s.playing.clipId
  if (s.settings.shuffle) {
    playedSet.add(cur)
    const cand = ids.filter(id => !playedSet.has(id))
    return cand.length ? cand[Math.floor(Math.random() * cand.length)] : null
  }
  const i = ids.indexOf(cur)
  if (i < 0) return ids[0] ?? null
  return i + 1 < ids.length ? ids[i + 1] : null
}

function prevClipId(): string | null {
  const s = useStore.getState()
  const pl = getPlayingPlaylist(s)
  if (!pl || !pl.items.length || !s.playing) return null
  const ids = pl.items.filter(c => !allDisabled(c) || c.id === s.playing!.clipId).map(c => c.id)
  while (historyStack.length) {
    const id = historyStack.pop()!
    if (ids.includes(id)) return id
  }
  if (s.settings.shuffle) return null
  const i = ids.indexOf(s.playing.clipId)
  if (i > 0) return ids[i - 1]
  return s.settings.loop === 'all' ? ids[ids.length - 1] : null
}

/* ---------- 公開 API ---------- */
export function play(playlistId: string, clipId: string, opts: { fromPrev?: boolean } = {}): void {
  trace('play', clipId, opts, new Error().stack?.split('\n').slice(2, 4).join(' | '))
  const s = useStore.getState()
  const pl = getPlaylistById(s, playlistId)
  const clip = pl?.items.find(c => c.id === clipId)
  if (!pl || !clip) return
  if (!ready || !player) {
    pendingPlay = { playlistId, clipId }
    useStore.setState({ playing: { playlistId, clipId } })
    return
  }
  const prevClip = getPlayingClip(s)
  if (s.playing && s.playing.playlistId !== playlistId) { playedSet.clear(); historyStack = [] }
  if (s.playing && s.playing.clipId !== clipId && !opts.fromPrev) {
    historyStack.push(s.playing.clipId)
    if (historyStack.length > 200) historyStack.shift()
  }
  playedSet.add(clipId)
  loadToken++
  segIndex = 0
  freePlay = false
  lastTickT = -1
  clipEndedFired = false
  hasPlayedThisLoad = false
  lastUiTime = -1
  const videoChanged = !prevClip || prevClip.videoId !== clip.videoId
  useStore.setState({
    playing: { playlistId, clipId },
    currentTime: firstStart(clip),
    marks: videoChanged ? { start: null, end: null } : s.marks,
  })
  updateSettings({ last: { playlistId, clipId } })

  const sameLoaded = loadedVideoId === clip.videoId && !clip.error
  if (!sameLoaded && playerIsStale()) {
    refreshPlayer({ playlistId, clipId })
    return
  }
  if (sameLoaded) {
    player.seekTo(firstStart(clip), true)
    player.playVideo()
    if (s.isPlaying) onStartedPlaying()   // 状態変化イベントが来ないので直接
  } else {
    loadedVideoId = clip.videoId
    prepareVolumeForLoad()
    player.loadVideoById({ videoId: clip.videoId, startSeconds: firstStart(clip) })
  }
  startWatchdog()
}

export function next(): void {
  trace('next', new Error().stack?.split('\n').slice(2, 4).join(' | '))
  const s = useStore.getState()
  if (!s.playing) { playFirstOfCurrent(); return }
  const ref = nextPlayRef()
  if (!ref) { toast('リストの最後です'); return }
  play(ref.playlistId, ref.clipId)
}

export function prev(): void {
  trace('prev', new Error().stack?.split('\n').slice(2, 4).join(' | '))
  const s = useStore.getState()
  if (!s.playing || !player) { playFirstOfCurrent(); return }
  const clip = getPlayingClip(s)
  let t = 0
  try { t = player.getCurrentTime() || 0 } catch { /* ignore */ }
  if (clip) {
    // 区間の頭から 3 秒以降なら区間の頭へ、それより前で前の区間があればその頭へ
    const seg = currentSeg(clip)
    if (t - seg.start > 3) { clipEndedFired = false; player.seekTo(seg.start, true); player.playVideo(); return }
    if (segIndex > 0 && !(s.editing && s.editing.clipId === clip.id)) {
      segIndex--
      clipEndedFired = false
      player.seekTo(playSegmentsOf(clip)[segIndex].start, true)
      player.playVideo()
      return
    }
  }
  const id = prevClipId()
  if (!id) { if (clip) { clipEndedFired = false; player.seekTo(firstStart(clip), true) } return }
  play(s.playing.playlistId, id, { fromPrev: true })
}

export function playFirstOfCurrent(): void {
  const s = useStore.getState()
  const pl = s.playlists.find(p => p.id === s.settings.currentPlaylistId) || s.playlists[0]
  if (!pl || !pl.items.length) { toast('クリップがありません。URL を追加してください。'); return }
  play(pl.id, pl.items[0].id)
}

export function togglePlay(): void {
  trace('togglePlay', new Error().stack?.split('\n').slice(2, 4).join(' | '))
  const s = useStore.getState()
  if (!s.playing) { playFirstOfCurrent(); return }
  if (!ready || !player || !yt) return
  const st = player.getPlayerState()
  if (st === yt.PlayerState.PLAYING || st === yt.PlayerState.BUFFERING) player.pauseVideo()
  else {
    const clip = getPlayingClip(s)
    // 区間の終わりで止まっている状態から再生 → 区間の頭へ
    if (clip && clipEndedFired) {
      const seg = currentSeg(clip)
      if (seg.end != null) {
        if (!(s.editing && s.editing.clipId === clip.id)) segIndex = 0
        clipEndedFired = false
        player.seekTo(currentSeg(clip).start, true)
      }
    }
    player.playVideo()
  }
}

export function stopPlayback(): void {
  useStore.setState({ playing: null, isPlaying: false, currentTime: 0, marks: { start: null, end: null } })
  updateSettings({ last: null })
  window.api.setPlaybackState(false)
  if (ready && player) { try { player.stopVideo() } catch { /* ignore */ } }
  loadedVideoId = null
}

/** 再生中の動画が videoId なら現在位置（0.1秒単位）、違えば null */
export function currentTimeOf(videoId: string): number | null {
  const s = useStore.getState()
  const clip = getPlayingClip(s)
  if (!clip || clip.videoId !== videoId || !player || !ready) return null
  try { return round1(player.getCurrentTime()) } catch { return null }
}

export function getCurrentTime(): number | null {
  if (!player || !ready) return null
  try { return round1(player.getCurrentTime()) } catch { return null }
}

/** クリップ削除後などに、再生中クリップが無くなったら後続へ */
export function onPlayingClipRemoved(playlistId: string, removedIndex: number): void {
  const s = useStore.getState()
  const pl = getPlaylistById(s, playlistId)
  if (!pl) { stopPlayback(); return }
  const nextClip = pl.items[removedIndex] || pl.items[0]
  if (nextClip) play(playlistId, nextClip.id)
  else stopPlayback()
}

/* ---------- 区間マーク ---------- */
export function markStart(): void {
  const t = getCurrentTime()
  if (t == null || !useStore.getState().playing) { toast('再生中の動画がありません'); return }
  useStore.setState({ marks: { ...useStore.getState().marks, start: t } })
  toast(`開始点: ${fmtTime(t)}`)
}

export function markEnd(): void {
  const t = getCurrentTime()
  if (t == null || !useStore.getState().playing) { toast('再生中の動画がありません'); return }
  useStore.setState({ marks: { ...useStore.getState().marks, end: t } })
  toast(`終了点: ${fmtTime(t)}`)
}

export function clearMarks(): void {
  useStore.setState({ marks: { start: null, end: null } })
}

/** マークした区間を、再生中の動画の新しいクリップとして直後に追加 */
export function addClipFromMarks(): Clip | null {
  const s = useStore.getState()
  const clip = getPlayingClip(s)
  if (!clip || !s.playing) { toast('再生中の動画がありません'); return null }
  const start = s.marks.start ?? clip.start
  const end = s.marks.end ?? (clip.end != null && clip.end > start ? clip.end : null)
  if (s.marks.start == null && s.marks.end == null) { toast('先に「開始点」「終了点」をマークしてください'); return null }
  if (end != null && end <= start) { toast('終了点が開始点より前です'); return null }
  return { id: '', videoId: clip.videoId, title: clip.title, author: clip.author, start, end, label: '', addedAt: Date.now() }
}

/* ---------- 頭出し（自動再生しない） ---------- */
export function cue(playlistId: string, clipId: string): void {
  trace('cue', clipId)
  const s = useStore.getState()
  const pl = getPlaylistById(s, playlistId)
  const clip = pl?.items.find(c => c.id === clipId)
  if (!pl || !clip) return
  if (!ready || !player) {
    useStore.setState({ playing: { playlistId, clipId }, currentTime: firstStart(clip) })
    return
  }
  const prevClip = getPlayingClip(s)
  if (s.playing && s.playing.playlistId !== playlistId) { playedSet.clear(); historyStack = [] }
  loadToken++
  segIndex = 0
  freePlay = false
  lastTickT = -1
  clipEndedFired = false
  hasPlayedThisLoad = false
  lastUiTime = -1
  pauseAfterPlaying = false
  const videoChanged = !prevClip || prevClip.videoId !== clip.videoId
  useStore.setState({
    playing: { playlistId, clipId },
    currentTime: firstStart(clip),
    marks: videoChanged ? { start: null, end: null } : s.marks,
  })
  updateSettings({ last: { playlistId, clipId } })
  if (loadedVideoId !== clip.videoId && playerIsStale()) {
    refreshPlayer(null)
    return
  }
  if (loadedVideoId === clip.videoId && !clip.error) {
    try { player.pauseVideo(); player.seekTo(firstStart(clip), true) } catch { /* ignore */ }
  } else {
    loadedVideoId = clip.videoId
    lastDuration = 0
    useStore.setState({ duration: clip.duration ?? 0 })
    player.cueVideoById({ videoId: clip.videoId, startSeconds: firstStart(clip) })
    const { settings } = useStore.getState()
    if (settings.rememberVolume) { try { player.setVolume(settings.volume) } catch { /* ignore */ } }
  }
  startWatchdog()
}

/**
 * プレビュー用シーク。再生中ならそのまま再生を続け、止まっていればその位置のフレームで止める。
 * まだ読み込んでいない（CUED）動画は「読み込んで止める」。
 */
export function seekPreview(t: number, final: boolean): void {
  if (!player || !ready || !yt) return
  const s = useStore.getState()
  const clip = getPlayingClip(s)
  if (!clip) return
  clipEndedFired = false
  let st = -1
  try { st = player.getPlayerState() } catch { /* ignore */ }
  if (st === yt.PlayerState.CUED || st === yt.PlayerState.UNSTARTED) {
    if (pauseAfterPlaying) { pendingSeek = t; return }  // 読み込み中: 最後の位置を覚えておく
    pauseAfterPlaying = true
    pendingSeek = null
    loadedVideoId = clip.videoId
    prepareVolumeForLoad()
    player.loadVideoById({ videoId: clip.videoId, startSeconds: t })
    return
  }
  if (pauseAfterPlaying) { pendingSeek = t; return }
  player.seekTo(t, final)
  if (!s.isPlaying) { try { player.pauseVideo() } catch { /* ignore */ } }
}

/** 区間の頭から再生（試聴）。区間エディタで編集中はその区間の頭から */
export function previewClip(): void {
  if (!player || !ready || !yt) return
  const s = useStore.getState()
  const clip = getPlayingClip(s)
  if (!clip) return
  const from = currentSeg(clip).start
  if (!(s.editing && s.editing.clipId === clip.id)) segIndex = 0
  clipEndedFired = false
  pauseAfterPlaying = false
  let st = -1
  try { st = player.getPlayerState() } catch { /* ignore */ }
  if (st === yt.PlayerState.CUED || st === yt.PlayerState.UNSTARTED) {
    loadedVideoId = clip.videoId
    prepareVolumeForLoad()
    player.loadVideoById({ videoId: clip.videoId, startSeconds: from })
    return
  }
  player.seekTo(from, true)
  player.playVideo()
}

/* ---------- 区間エディタ ---------- */
export function openClipEditor(playlistId: string, clipId: string, isNew: boolean, returnTo: string | null = null): void {
  const s = useStore.getState()
  const isCurrent = s.playing && s.playing.playlistId === playlistId && s.playing.clipId === clipId
  // キャンセルで戻せるよう、開いた時点のクリップを覚えておく
  const original = getPlaylistById(s, playlistId)?.items.find(c => c.id === clipId) ?? null
  useStore.setState({ editing: { playlistId, clipId, isNew, returnTo, seg: 0, original } })
  if (!isCurrent) play(playlistId, clipId)
  else if (!s.isPlaying) previewClip()
}

/** 「同じ動画から区間を追加」: 直後に新しいクリップを作ってエディタを開く */
export function addClipFromSameVideo(playlistId: string, source: Clip): void {
  const s = useStore.getState()
  const dur = source.duration ?? (getPlayingClip(s)?.videoId === source.videoId && s.duration > 0 ? s.duration : null)
  const now = currentTimeOf(source.videoId)
  let start = now != null ? now : (source.end != null ? source.end : source.start)
  if (dur != null && start > dur - 1) start = Math.max(0, dur - 10)
  let end: number | null = start + 10
  if (dur != null && end > dur) end = dur
  const clip: Clip = { ...source, id: uid(), start, end, label: '', addedAt: Date.now(), error: undefined }
  delete clip.error
  if (!addClips(playlistId, [clip], source.id)) { toast('同じ区間が既にあります'); return }
  openClipEditor(playlistId, clip.id, true, source.id)
}

export function closeClipEditor(cancel = false): void {
  const s = useStore.getState()
  if (!s.editing) return
  const { playlistId, clipId, isNew, returnTo, seg, original } = s.editing
  useStore.setState({ editing: null })
  // キャンセル: 開いた時点の区間・色・メモに戻す（新しく作った区間は下で削除する）
  if (cancel && !isNew && original) {
    updatePlaylist(playlistId, pl => ({ ...pl, items: pl.items.map(c => (c.id === clipId ? original : c)) }))
    if (s.playing?.clipId === clipId) segIndex = 0
  } else if (s.playing?.clipId === clipId) {
    // 編集していた区間から、続けて順に再生する（無効の区間なら、その後ろの有効な区間から）
    const clip = getPlaylistById(useStore.getState(), playlistId)?.items.find(c => c.id === clipId)
    if (clip) {
      // 有効な区間の番号（全部無効なら全区間）の中で、seg 以降の最初のもの
      const all = segmentsOf(clip)
      let on = all.map((g, i) => (g.disabled ? -1 : i)).filter(i => i >= 0)
      if (!on.length) on = all.map((_, i) => i)
      const k = on.findIndex(i => i >= seg)
      segIndex = k >= 0 ? k : 0
    }
  }
  if (cancel && isNew) {
    removeClip(playlistId, clipId)
    if (s.playing && s.playing.clipId === clipId) {
      const pl = getPlaylistById(useStore.getState(), playlistId)
      const back = (returnTo && pl?.items.find(c => c.id === returnTo)) || pl?.items[0]
      if (back) play(playlistId, back.id); else stopPlayback()
    }
  }
}

/** プレーヤー直下のバーのクリック・ドラッグ: その位置へ移る（再生中なら再生を続け、止まっていればその場面を表示） */
export function seekTo(t: number, final: boolean): void {
  const s = useStore.getState()
  const clip = getPlayingClip(s)
  if (!clip) return
  if (!(s.editing && s.editing.clipId === clip.id)) syncSegToTime(clip, t)
  lastTickT = t
  useStore.setState({ currentTime: t })
  seekPreview(t, final)
}

/** 区間エディタで編集する区間を選ぶ（その区間の頭へ移る） */
export function selectSegment(i: number): void {
  const s = useStore.getState()
  if (!s.editing) return
  useStore.setState({ editing: { ...s.editing, seg: i } })
  const clip = getPlayingClip(useStore.getState())
  if (clip && clip.id === s.editing.clipId) {
    const seg = segmentsOf(clip)[i]
    if (seg) seekPreview(seg.start, true)
  }
}

/** つまみのドラッグ中: 区間終了の判定を止める（再生は止めない） */
export function setScrubbing(on: boolean): void {
  scrubbing = on
}

// 開発時のみ: 動作確認用にプレーヤーを公開
if (import.meta.env.DEV) (window as unknown as { __player: () => YTPlayer | null }).__player = () => player
