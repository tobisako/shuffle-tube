import { parseYouTubeT } from './time'

export const ID_RE = /^[A-Za-z0-9_-]{11}$/
export const thumbUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
export const watchUrl = (id: string, start?: number): string =>
  `https://www.youtube.com/watch?v=${id}` + (start ? `&t=${Math.floor(start)}s` : '')

export interface ParsedVideo { id: string; start: number | null; end: number | null }
export interface ParsedInput { videos: ParsedVideo[]; lists: string[] }

/** 入力欄のテキストから 動画ID(+開始/終了) と 再生リストID を取り出す */
export function parseInput(text: string): ParsedInput {
  const videos: ParsedVideo[] = []
  const lists: string[] = []
  const seenV = new Set<string>()
  for (const tok of text.split(/[\s,]+/).filter(Boolean)) {
    if (ID_RE.test(tok)) {
      if (!seenV.has(tok)) { seenV.add(tok); videos.push({ id: tok, start: null, end: null }) }
      continue
    }
    let url: URL
    try { url = new URL(/^https?:\/\//i.test(tok) ? tok : 'https://' + tok) } catch { continue }
    const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
    let v: string | null = null
    if (host === 'youtu.be') {
      v = url.pathname.slice(1).split('/')[0]
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      v = url.searchParams.get('v')
      if (!v) {
        const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/)
        if (m) v = m[1]
      }
    }
    if (v && ID_RE.test(v)) {
      const start = parseYouTubeT(url.searchParams.get('t')) ?? parseYouTubeT(url.searchParams.get('start'))
      const end = parseYouTubeT(url.searchParams.get('end'))
      const key = `${v}|${start ?? ''}|${end ?? ''}`
      if (!seenV.has(key)) { seenV.add(key); videos.push({ id: v, start, end }) }
      continue
    }
    const list = url.searchParams.get('list')
    if (list && /^[A-Za-z0-9_-]+$/.test(list) && !lists.includes(list)) lists.push(list)
  }
  return { videos, lists }
}

/* ---------- IFrame Player API ---------- */
export interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number; endSeconds?: number }): void
  cueVideoById(o: { videoId: string; startSeconds?: number; endSeconds?: number }): void
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  getVolume(): number
  setVolume(v: number): void
  isMuted(): boolean
  mute(): void
  unMute(): void
  getPlaybackRate(): number
  setPlaybackRate(r: number): void
  getVideoData(): { video_id?: string; title?: string; author?: string }
  getPlaylist(): string[] | null
  destroy(): void
}
export interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer
  PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 }
}
declare global {
  interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }
}

let ytPromise: Promise<YTNamespace> | null = null
export function loadYT(): Promise<YTNamespace> {
  if (ytPromise) return ytPromise
  ytPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return }
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!)
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.onerror = () => { ytPromise = null; reject(new Error('YouTube API の読み込みに失敗しました')) }
    document.head.appendChild(s)
  })
  return ytPromise
}

/** 非表示プレーヤーに再生リストを読ませて動画IDを得る (Data API キー不要) */
export async function importYouTubePlaylist(listId: string): Promise<string[]> {
  const yt = await loadYT()
  const holder = document.getElementById('import-player-holder')
  if (!holder) throw new Error('holder not found')
  const inner = document.createElement('div')
  holder.appendChild(inner)
  return new Promise<string[]>((resolve, reject) => {
    let timer: number | null = null
    let tries = 0
    let p: YTPlayer | null = null
    const cleanup = (): void => {
      if (timer) window.clearInterval(timer)
      try { p?.destroy() } catch { /* ignore */ }
      inner.remove()
    }
    p = new yt.Player(inner, {
      width: 320, height: 200,
      playerVars: { listType: 'playlist', list: listId },
      events: {
        onReady: () => {
          timer = window.setInterval(() => {
            tries++
            let ids: string[] | null = null
            try { ids = p!.getPlaylist() } catch { /* ignore */ }
            if (Array.isArray(ids) && ids.length) { cleanup(); resolve(ids) }
            else if (tries > 60) { cleanup(); reject(new Error('timeout')) }
          }, 250)
        },
        onError: () => { cleanup(); reject(new Error('player error')) },
      },
    })
  })
}
