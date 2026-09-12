import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { LIBRARY_ID, libraryClipId, type LibraryVideo } from '@shared/types'
import { addClips, getCurrentPlaylist, makeClip, removeFromLibrary, setLibraryMemo, switchPlaylist, toast, updateSettings, usageCount, useStore } from '../store'
import { play } from '../player'
import { thumbUrl, watchUrl } from '../youtube'
import { fmtTime } from '../time'

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** ライブラリ（動画の保管庫）一覧 */
export default function LibraryView(): JSX.Element {
  const library = useStore(s => s.library)
  const playlists = useStore(s => s.playlists)
  const target = useStore(getCurrentPlaylist)
  const playing = useStore(s => s.playing)
  const state = useStore(s => s)
  const [filter, setFilter] = useState('')
  const [memoEdit, setMemoEdit] = useState<string | null>(null)

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = library.slice().sort((a, b) => b.addedAt - a.addedAt)
    if (!q) return list
    return list.filter(v => (v.title + ' ' + v.author + ' ' + v.memo + ' ' + v.videoId).toLowerCase().includes(q))
  }, [library, filter])

  const addWhole = (v: LibraryVideo): void => {
    if (!target) return
    const c = makeClip(v.videoId, 0, null)
    c.title = v.title; c.author = v.author; c.duration = v.duration
    const n = addClips(target.id, [c])
    toast(n ? `「${target.name}」に追加しました。プレイリストで ✎ を押すと区間を設定できます` : `「${target.name}」に同じクリップがあります`)
  }
  const remove = (v: LibraryVideo): void => {
    const n = usageCount(state, v.videoId)
    if (!window.confirm(`「${v.title || v.videoId}」をライブラリから削除しますか？` + (n ? `\n（プレイリストの ${n} クリップは残ります）` : ''))) return
    removeFromLibrary(v.videoId)
  }

  return (
    <>
      <div className="list-header">
        <span className="playlist-name lib-title">ライブラリ</span>
        <span className="count">{library.length} 本{filter && shown.length !== library.length ? `（表示 ${shown.length}）` : ''}</span>
        <input className="lib-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="タイトル・投稿者・メモで絞り込み" />
        <label className="lib-target">追加先
          <select value={target?.id ?? ''} onChange={e => updateSettings({ currentPlaylistId: e.target.value })}>
            {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button className="text-btn" disabled={!library.length} onClick={() => play(LIBRARY_ID, libraryClipId(shown[0]?.videoId ?? library[0].videoId))} title="ライブラリの動画を上から順に連続再生">▶ 全て再生</button>
      </div>
      <ol className="items">
        {library.length === 0 && (
          <li className="empty">
            まだ動画がありません。<br />
            上の欄に YouTube の URL を貼り付けて「保存」すると、ここに溜まります。<br />
            <span className="small">動画 URL・Shorts・短縮 URL・再生リスト URL・動画ID に対応。プレイリストに追加した動画も自動でここに入ります。</span>
          </li>
        )}
        {library.length > 0 && shown.length === 0 && <li className="empty">絞り込みに一致する動画がありません</li>}
        {shown.map(v => {
          const isPlaying = playing?.playlistId === LIBRARY_ID && playing.clipId === libraryClipId(v.videoId)
          const used = usageCount(state, v.videoId)
          return (
            <li key={v.videoId} className="item-wrap">
              <div className={'item lib-item' + (isPlaying ? ' playing' : '')} onClick={() => play(LIBRARY_ID, libraryClipId(v.videoId))} title="クリックでプレビュー再生">
                <div className="idx">{isPlaying ? '♪' : ''}</div>
                <div className="thumb-wrap">
                  <img className="thumb" src={thumbUrl(v.videoId)} alt="" loading="lazy" draggable={false} />
                  <span className="thumb-badge">{v.duration != null ? fmtTime(v.duration, false) : '--:--'}</span>
                </div>
                <div className="meta">
                  <div className="title">{v.title || v.videoId}</div>
                  <div className="sub">
                    {v.author && <span className="author">{v.author}</span>}
                    <span className="lib-used">{used ? `使用 ${used} クリップ` : '未使用'}</span>
                    <span className="lib-date">{fmtDate(v.addedAt)}</span>
                    {memoEdit === v.videoId ? (
                      <input className="lib-memo-in" autoFocus value={v.memo} maxLength={80} placeholder="メモ"
                        onClick={e => e.stopPropagation()}
                        onChange={e => setLibraryMemo(v.videoId, e.target.value)}
                        onBlur={() => setMemoEdit(null)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setMemoEdit(null) }} />
                    ) : (
                      <span className={'lib-memo' + (v.memo ? '' : ' empty')} onClick={e => { e.stopPropagation(); setMemoEdit(v.videoId) }} title="クリックでメモを編集">{v.memo || 'メモを追加'}</span>
                    )}
                  </div>
                </div>
                <div className="actions" onClick={e => e.stopPropagation()}>
                  <button title="プレビュー再生（区間マークで追加先に区間を登録できます）" onClick={() => play(LIBRARY_ID, libraryClipId(v.videoId))}>▶</button>
                  <button title={`動画まるごと「${target?.name ?? ''}」に追加`} onClick={() => addWhole(v)}>＋</button>
                  <button title="追加先プレイリストを開く" onClick={() => { if (target) switchPlaylist(target.id) }}>≡</button>
                  <button title="YouTube で開く" onClick={() => window.api.openExternal(watchUrl(v.videoId))}>↗</button>
                  <button className="del" title="ライブラリから削除" onClick={() => remove(v)}>✕</button>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </>
  )
}
