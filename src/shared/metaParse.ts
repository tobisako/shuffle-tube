/** YouTube のメタデータ取得ロジック（main と Android 版で共有）。HTTP の実行は fetchText / fetchJson に委ねる */
import type { VideoMeta } from './types'

export const ID_RE = /^[A-Za-z0-9_-]{11}$/

export interface HttpFns {
  fetchJson(url: string): Promise<unknown | null>
  fetchText(url: string, headers?: Record<string, string>): Promise<string | null>
}

export async function fetchOEmbedWith(h: HttpFns, videoId: string): Promise<{ title: string; author: string } | null> {
  const target = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)
  const urls = [
    `https://www.youtube.com/oembed?url=${target}&format=json`,
    `https://noembed.com/embed?url=${target}`,
  ]
  for (const u of urls) {
    const j = (await h.fetchJson(u)) as { title?: string; author_name?: string } | null
    if (j && j.title) return { title: j.title, author: j.author_name || '' }
  }
  return null
}

/** 動画の長さ: 視聴ページの HTML から lengthSeconds を拾う（ベストエフォート） */
export async function fetchDurationWith(h: HttpFns, videoId: string): Promise<number | null> {
  const html = await h.fetchText(`https://www.youtube.com/watch?v=${videoId}&hl=ja`, {
    'Accept-Language': 'ja,en;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  })
  if (!html) return null
  const m = html.match(/"lengthSeconds":"(\d+)"/) || html.match(/"approxDurationMs":"(\d+)"/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return m[0].startsWith('"approxDurationMs') ? n / 1000 : n
}

export async function fetchMetaWith(h: HttpFns, videoId: string): Promise<VideoMeta | null> {
  if (!ID_RE.test(videoId)) return null
  const [meta, duration] = await Promise.all([fetchOEmbedWith(h, videoId), fetchDurationWith(h, videoId)])
  if (!meta && duration == null) return null
  return { title: meta?.title ?? '', author: meta?.author ?? '', duration }
}
