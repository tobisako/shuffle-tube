import { net } from 'electron'
import { fetchMetaWith, ID_RE, type HttpFns } from '@shared/metaParse'
import type { VideoMeta } from '@shared/types'

export { ID_RE }

const http: HttpFns = {
  async fetchJson(url) {
    try {
      const r = await net.fetch(url)
      return r.ok ? await r.json() : null
    } catch { return null }
  },
  async fetchText(url, headers) {
    try {
      const r = await net.fetch(url, { headers })
      return r.ok ? await r.text() : null
    } catch { return null }
  },
}

export function fetchMeta(videoId: string): Promise<VideoMeta | null> {
  return fetchMetaWith(http, videoId)
}
