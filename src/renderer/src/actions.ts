import { LIBRARY_ID, type Clip, type Playlist } from '@shared/types'
import { addClips, ensureInLibrary, fillMeta, getCurrentPlaylist, makeClip, toast, uid, updateSettings, useStore } from './store'
import { ID_RE, importYouTubePlaylist, parseInput } from './youtube'

/**
 * 再生中クリップの直後に追加。ライブラリをプレビュー中、または再生していないときは
 * 追加先（現在の）プレイリストの末尾に追加する。戻り値 = 追加数、追加先名
 */
export function addClipsAfterPlaying(clips: Clip[]): { added: number; target: string } {
  const s = useStore.getState()
  const withIds = clips.map(c => ({ ...c, id: c.id || uid() }))
  if (s.playing && s.playing.playlistId !== LIBRARY_ID) {
    const pl = s.playlists.find(p => p.id === s.playing!.playlistId)
    return { added: addClips(s.playing.playlistId, withIds, s.playing.clipId), target: pl?.name ?? '' }
  }
  const pl = getCurrentPlaylist(s)
  return pl ? { added: addClips(pl.id, withIds), target: pl.name } : { added: 0, target: '' }
}

/** 入力欄からの追加。ライブラリ表示中はライブラリに保存、プレイリスト表示中はクリップとして追加（ライブラリにも登録） */
export async function addFromInput(text: string): Promise<void> {
  const { videos, lists } = parseInput(text)
  if (!videos.length && !lists.length) { toast('YouTube の URL または動画IDとして認識できませんでした'); return }
  const st = useStore.getState()
  if (st.settings.view === 'library') {
    let n = 0
    if (videos.length) n += ensureInLibrary(videos.map(v => v.id))
    for (const listId of lists) {
      toast('YouTube 再生リストを読み込み中…')
      try { n += ensureInLibrary(await importYouTubePlaylist(listId)) }
      catch { toast('再生リストを読み込めませんでした（非公開・存在しない・ネット接続）') }
    }
    toast(n ? `ライブラリに ${n}本 保存しました` : '全て登録済みです')
    return
  }
  const pl = getCurrentPlaylist(st)
  if (!pl) return
  if (videos.length) {
    const clips: Clip[] = videos.map(v => {
      const st = v.start ?? 0
      const en = v.end != null && v.end > st ? v.end : null
      return makeClip(v.id, st, en)
    })
    const n = addClips(pl.id, clips)
    toast(n ? `${n}件追加しました` : '同じ区間が既にあります')
  }
  for (const listId of lists) {
    toast('YouTube 再生リストを読み込み中…')
    try {
      const ids = await importYouTubePlaylist(listId)
      const n = addClips(pl.id, ids.map(id => makeClip(id, 0, null)))
      toast(`再生リストから ${n}件追加しました`)
    } catch {
      toast('再生リストを読み込めませんでした（非公開・存在しない・ネット接続）')
    }
  }
}

export async function exportJson(): Promise<void> {
  const s = useStore.getState()
  const data = { app: 'ShuffleTube', version: 2, exportedAt: new Date().toISOString(), playlists: s.playlists }
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const name = `shuffle-tube_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`
  const ok = await window.api.exportPlaylists(JSON.stringify(data, null, 2), name)
  if (ok) toast('書き出しました')
}

export async function importJson(): Promise<void> {
  const text = await window.api.importPlaylists()
  if (text == null) return
  try {
    const j = JSON.parse(text) as unknown
    const src = Array.isArray(j) ? j : (j && typeof j === 'object' && Array.isArray((j as { playlists?: unknown }).playlists) ? (j as { playlists: unknown[] }).playlists : null)
    if (!src) throw new Error('形式が違います')
    const imported: Playlist[] = []
    for (const raw of src) {
      const p = raw as { name?: unknown; items?: unknown }
      if (!p || !Array.isArray(p.items)) continue
      const items: Clip[] = []
      for (const it of p.items as Record<string, unknown>[]) {
        const videoId = typeof it.videoId === 'string' ? it.videoId : (typeof it.id === 'string' ? it.id : '')
        if (!ID_RE.test(videoId)) continue
        const start = typeof it.start === 'number' && it.start >= 0 ? it.start : 0
        const end = typeof it.end === 'number' && it.end > start ? it.end : null
        items.push({
          id: uid(), videoId,
          title: typeof it.title === 'string' ? it.title : '',
          author: typeof it.author === 'string' ? it.author : '',
          start, end,
          label: typeof it.label === 'string' ? it.label : '',
          addedAt: typeof it.addedAt === 'number' ? it.addedAt : Date.now(),
          duration: typeof it.duration === 'number' ? it.duration : null,
        })
      }
      imported.push({ id: uid(), name: typeof p.name === 'string' && p.name ? p.name : 'インポート', items })
    }
    if (!imported.length) throw new Error('プレイリストがありません')
    useStore.setState({ playlists: [...useStore.getState().playlists, ...imported] })
    updateSettings({ currentPlaylistId: imported[imported.length - 1].id })
    toast(`${imported.length}件のプレイリストを読み込みました`)
    // タイトル未取得のものを補完
    const ids = [...new Set(imported.flatMap(p => p.items).filter(c => !c.title).map(c => c.videoId))]
    for (const id of ids) window.api.fetchMeta(id).then(m => { if (m) fillMeta(id, m.title, m.author, m.duration) })
  } catch (e) {
    toast(`読み込み失敗: ${(e as Error).message}`)
  }
}
