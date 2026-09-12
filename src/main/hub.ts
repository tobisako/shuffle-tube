import { store } from './store'
import type { DataKind, HistoryEntry, LibraryVideo, Playlist } from '@shared/types'

export type Listener = (kind: DataKind, data: unknown, clientId: string) => void
const listeners = new Set<Listener>()

/** Electron の renderer を表すクライアント ID */
export const ELECTRON_CLIENT = 'electron'

/** 保存して、全リスナーに通知する（通知先で clientId を見て自分の echo を無視する） */
export function publish(kind: DataKind, data: unknown, clientId: string): void {
  if (kind === 'playlists') store.savePlaylists(data as Playlist[])
  else if (kind === 'library') store.saveLibrary(data as LibraryVideo[])
  else store.saveHistory(data as HistoryEntry[])
  for (const l of listeners) {
    try { l(kind, data, clientId) } catch (e) { console.warn('[hub] listener error', e) }
  }
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
