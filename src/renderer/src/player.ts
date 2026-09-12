/**
 * プレーヤー制御（モジュール単位のシングルトン）
 *  - YouTube IFrame Player を1つだけ生成し、React ツリーの外で管理する
 *  - 区間再生: 100ms ごとに現在位置を監視し、終了秒で次のクリップへ
 */
import type { Clip } from '@shared/types'
import { addClips, addHistory, fillMeta, getPlayingClip, getPlayingPlaylist, getPlaylistById, removeClip, toast, updateClip, updateSettings, useStore, type PlayingRef } from './store'
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

/* ---------- 生成 ---------- */
export async function mountPlayer(container: HTMLElement): Promise<void> {
  if (player || container.dataset.mounted) return
  container.dataset.mounted = '1'
  const inner = document.createElement('div')
  container.appendChild(inner)
  try {
    yt = await loadYT()
  } catch (e) {
    toast((e as Error).message)
    return
  }
  player = new yt.Player(inner, {
    width: '100%',
    height: '100%',
    playerVars: { rel: 0, playsinline: 1, modestbranding: 1, controls: 1, iv_load_policy: 3 },
    events: { onReady, onStateChange, onError, onPlaybackRateChange },
  })
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
      useStore.setState({ playing: { playlistId: pl.id, clipId: clip.id }, currentTime: clip.start })
      loadedVideoId = clip.videoId
      player!.cueVideoById({ videoId: clip.videoId, startSeconds: clip.start })
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
    153: '埋め込み元の情報が不足しています (153)',
  }
  const s = useStore.getState()
  const clip = getPlayingClip(s)
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

  // 区間の終わりで止めた後、区間内に戻ったら終了判定を再び有効にする
  if (clipEndedFired && clip.end != null && t < clip.end - 0.5) clipEndedFired = false

  // 編集中: 再生位置が開始バーより前に行ったら開始位置へ戻す（YouTube 側のシークバー操作を含む）
  if (s.editing && s.editing.clipId === clip.id && s.isPlaying && hasPlayedThisLoad && !scrubbing && t < clip.start - 0.3) {
    try { player.seekTo(clip.start, true) } catch { /* ignore */ }
    return
  }

  if (clip.end != null && !clipEndedFired && !scrubbing && hasPlayedThisLoad && s.isPlaying && t >= clip.start - 0.5 && t >= clip.end - 0.05) {
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
  if (s.settings.loop === 'one') {
    clipEndedFired = false
    player.seekTo(clip.start, true)
    player.playVideo()
    return
  }
  if (s.editing && s.editing.clipId === clip.id) {
    // 区間エディタで編集中: 次へ進まず、区間を繰り返し再生し続ける
    clipEndedFired = false
    player.seekTo(clip.start, true)
    player.playVideo()
    return
  }
  const nextId = nextClipId()
  if (!nextId) {
    try { if (clip.end != null) player.pauseVideo() } catch { /* ignore */ }
    useStore.setState({ isPlaying: false })
    window.api.setPlaybackState(false)
    return
  }
  play(s.playing.playlistId, nextId)
}

function nextClipId(): string | null {
  const s = useStore.getState()
  const pl = getPlayingPlaylist(s)
  if (!pl || !pl.items.length || !s.playing) return null
  const ids = pl.items.map(c => c.id)
  const cur = s.playing.clipId
  if (s.settings.shuffle) {
    playedSet.add(cur)
    let cand = ids.filter(id => !playedSet.has(id))
    if (!cand.length) {
      if (s.settings.loop !== 'all') return null
      playedSet.clear()
      playedSet.add(cur)
      cand = ids.filter(id => id !== cur)
      if (!cand.length) return cur
    }
    return cand[Math.floor(Math.random() * cand.length)]
  }
  const i = ids.indexOf(cur)
  if (i < 0) return ids[0]
  if (i + 1 < ids.length) return ids[i + 1]
  return s.settings.loop === 'all' ? ids[0] : null
}

function prevClipId(): string | null {
  const s = useStore.getState()
  const pl = getPlayingPlaylist(s)
  if (!pl || !pl.items.length || !s.playing) return null
  const ids = pl.items.map(c => c.id)
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
  clipEndedFired = false
  hasPlayedThisLoad = false
  lastUiTime = -1
  const videoChanged = !prevClip || prevClip.videoId !== clip.videoId
  useStore.setState({
    playing: { playlistId, clipId },
    currentTime: clip.start,
    marks: videoChanged ? { start: null, end: null } : s.marks,
  })
  updateSettings({ last: { playlistId, clipId } })

  const sameLoaded = loadedVideoId === clip.videoId && !clip.error
  if (sameLoaded) {
    player.seekTo(clip.start, true)
    player.playVideo()
    if (s.isPlaying) onStartedPlaying()   // 状態変化イベントが来ないので直接
  } else {
    loadedVideoId = clip.videoId
    prepareVolumeForLoad()
    player.loadVideoById({ videoId: clip.videoId, startSeconds: clip.start })
  }
  startWatchdog()
}

export function next(): void {
  trace('next', new Error().stack?.split('\n').slice(2, 4).join(' | '))
  const s = useStore.getState()
  if (!s.playing) { playFirstOfCurrent(); return }
  const id = nextClipId()
  if (!id) { toast('リストの最後です'); return }
  play(s.playing.playlistId, id)
}

export function prev(): void {
  trace('prev', new Error().stack?.split('\n').slice(2, 4).join(' | '))
  const s = useStore.getState()
  if (!s.playing || !player) { playFirstOfCurrent(); return }
  const clip = getPlayingClip(s)
  let t = 0
  try { t = player.getCurrentTime() || 0 } catch { /* ignore */ }
  if (clip && t - clip.start > 3) { clipEndedFired = false; player.seekTo(clip.start, true); player.playVideo(); return }
  const id = prevClipId()
  if (!id) { if (clip) { clipEndedFired = false; player.seekTo(clip.start, true) } return }
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
    if (clip && clip.end != null && clipEndedFired) { clipEndedFired = false; player.seekTo(clip.start, true) }
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
    useStore.setState({ playing: { playlistId, clipId }, currentTime: clip.start })
    return
  }
  const prevClip = getPlayingClip(s)
  if (s.playing && s.playing.playlistId !== playlistId) { playedSet.clear(); historyStack = [] }
  loadToken++
  clipEndedFired = false
  hasPlayedThisLoad = false
  lastUiTime = -1
  pauseAfterPlaying = false
  const videoChanged = !prevClip || prevClip.videoId !== clip.videoId
  useStore.setState({
    playing: { playlistId, clipId },
    currentTime: clip.start,
    marks: videoChanged ? { start: null, end: null } : s.marks,
  })
  updateSettings({ last: { playlistId, clipId } })
  if (loadedVideoId === clip.videoId && !clip.error) {
    try { player.pauseVideo(); player.seekTo(clip.start, true) } catch { /* ignore */ }
  } else {
    loadedVideoId = clip.videoId
    lastDuration = 0
    useStore.setState({ duration: clip.duration ?? 0 })
    player.cueVideoById({ videoId: clip.videoId, startSeconds: clip.start })
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

/** 区間の頭から再生（試聴） */
export function previewClip(): void {
  if (!player || !ready || !yt) return
  const s = useStore.getState()
  const clip = getPlayingClip(s)
  if (!clip) return
  clipEndedFired = false
  pauseAfterPlaying = false
  let st = -1
  try { st = player.getPlayerState() } catch { /* ignore */ }
  if (st === yt.PlayerState.CUED || st === yt.PlayerState.UNSTARTED) {
    loadedVideoId = clip.videoId
    prepareVolumeForLoad()
    player.loadVideoById({ videoId: clip.videoId, startSeconds: clip.start })
    return
  }
  player.seekTo(clip.start, true)
  player.playVideo()
}

/* ---------- 区間エディタ ---------- */
export function openClipEditor(playlistId: string, clipId: string, isNew: boolean, returnTo: string | null = null): void {
  const s = useStore.getState()
  const isCurrent = s.playing && s.playing.playlistId === playlistId && s.playing.clipId === clipId
  useStore.setState({ editing: { playlistId, clipId, isNew, returnTo } })
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
  const { playlistId, clipId, isNew, returnTo } = s.editing
  useStore.setState({ editing: null })
  if (cancel && isNew) {
    removeClip(playlistId, clipId)
    if (s.playing && s.playing.clipId === clipId) {
      const pl = getPlaylistById(useStore.getState(), playlistId)
      const back = (returnTo && pl?.items.find(c => c.id === returnTo)) || pl?.items[0]
      if (back) play(playlistId, back.id); else stopPlayback()
    }
  }
}

/** つまみのドラッグ中: 区間終了の判定を止める（再生は止めない） */
export function setScrubbing(on: boolean): void {
  scrubbing = on
}
