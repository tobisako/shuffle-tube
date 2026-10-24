import type { JSX } from 'react'
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import type { Clip } from '@shared/types'
import { clearPlaylist, toggleChain, toggleSegmentDisabled, updateClip, deletePlaylist, getCurrentPlaylist, moveClip, newPlaylist, removeClip, renamePlaylist, switchPlaylist, useStore } from '../store'
import { useIsMobile } from '../useIsMobile'
import { addClipFromSameVideo, closeClipEditor, onPlayingClipRemoved, openClipEditor, play, stopPlayback } from '../player'
import { thumbUrl, watchUrl } from '../youtube'
import { fmtDuration, fmtTime } from '../time'
import RangeEditor from './RangeEditor'
import { setDraggingClip } from '../dnd'
import { segColor, segmentsOf, totalLength } from '../segments'
import { isComposing } from '../ime'

export default function ItemList(): JSX.Element | null {
  const pl = useStore(getCurrentPlaylist)
  const playlists = useStore(s => s.playlists)
  const isMobile = useIsMobile()
  const playing = useStore(s => s.playing)
  const editing = useStore(s => s.editing)
  const focusName = useStore(s => s.focusNameInput)
  const readOnly = useStore(s => s.readOnly)
  const loopOne = useStore(s => s.settings.loop === 'one')
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(pl?.name ?? '')
  const dragId = useRef<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; before: boolean } | null>(null)
  /** メモを書いているクリップ */
  const [memoEdit, setMemoEdit] = useState<string | null>(null)

  useEffect(() => { setName(pl?.name ?? '') }, [pl?.id, pl?.name])
  useEffect(() => {
    if (!focusName) return
    window.setTimeout(() => { nameRef.current?.focus(); nameRef.current?.select() }, 30)
  }, [focusName])

  if (!pl) return null

  const commitName = (): void => {
    if (name.trim()) renamePlaylist(pl.id, name)
    else setName(pl.name)
  }

  const onDeleteList = (): void => {
    if (!window.confirm(`「${pl.name}」を削除しますか？（${pl.items.length}件）`)) return
    const wasPlaying = playing?.playlistId === pl.id
    closeClipEditor(false)
    deletePlaylist(pl.id)
    if (wasPlaying) stopPlayback()
  }
  const onClearList = (): void => {
    if (!pl.items.length) return
    if (!window.confirm(`「${pl.name}」のクリップ ${pl.items.length}件 を全て削除しますか？`)) return
    const wasPlaying = playing?.playlistId === pl.id
    closeClipEditor(false)
    clearPlaylist(pl.id)
    if (wasPlaying) stopPlayback()
  }

  const onRemove = (clip: Clip): void => {
    const idx = pl.items.findIndex(c => c.id === clip.id)
    const wasPlaying = playing?.playlistId === pl.id && playing.clipId === clip.id
    if (editing?.clipId === clip.id) closeClipEditor(false)
    removeClip(pl.id, clip.id)
    if (wasPlaying) onPlayingClipRemoved(pl.id, idx)
  }

  const onDropOn = (target: Clip, before: boolean): void => {
    const from = pl.items.findIndex(c => c.id === dragId.current)
    let to = pl.items.findIndex(c => c.id === target.id)
    if (from < 0 || to < 0) return
    if (!before) to++
    if (from < to) to--
    moveClip(pl.id, from, to)
  }

  return (
    <>
      {isMobile && (
        <div className="mobile-pl-select">
          <select value={pl.id} onChange={e => switchPlaylist(e.target.value)} title="プレイリストを切り替え">
            {playlists.map(p => <option key={p.id} value={p.id}>{p.chain ? '🔗 ' : ''}{p.name}（{p.items.length}）</option>)}
          </select>
          {!readOnly && <button className="icon-btn" title="新しいプレイリスト" onClick={() => { newPlaylist(); useStore.setState({ focusNameInput: Date.now() }) }}>＋</button>}
        </div>
      )}
      <div className="list-header">
        <input ref={nameRef} className="playlist-name" value={name} maxLength={60} title={readOnly ? '' : 'クリックで名前を変更'} readOnly={readOnly}
          onChange={e => setName(e.target.value)} onBlur={commitName}
          onKeyDown={e => { if (isComposing(e)) return; if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        <span className="count">{pl.items.length} クリップ</span>
        <label className={'chain-toggle' + (pl.chain ? ' on' : '')}
          title="ON にしたリストどうしは、最後まで行ったら並び順で次の ON のリストへ続けて再生します">
          <span className="switch-mini"><input type="checkbox" checked={!!pl.chain} onChange={() => toggleChain(pl.id)} /><span className="knob" /></span>
          またいで再生
          {pl.chain && loopOne && <span className="chain-note">（1曲リピート中はまたぎません）</span>}
        </label>
        {!readOnly && <button className="text-btn danger" onClick={onClearList} title="このプレイリストのクリップを全て削除">全削除</button>}
        {!readOnly && <button className="text-btn danger" onClick={onDeleteList} title="このプレイリストを削除">リスト削除</button>}
      </div>
      <ol className="items" onDragLeave={e => { if (e.currentTarget === e.target) setDrop(null) }}>
        {pl.items.length === 0 && readOnly && <li className="empty">このプレイリストにはクリップがありません</li>}
        {pl.items.length === 0 && !readOnly && (
          <li className="empty">
            まだクリップがありません。<br />
            上の欄に YouTube の URL を貼り付けて「追加」してください。<br />
            <span className="small">動画 URL・Shorts・短縮 URL・再生リスト URL・動画ID に対応。追加後、✎ で区間をドラッグして設定できます。</span>
          </li>
        )}
        {pl.items.map((clip, idx) => {
          const isPlaying = playing?.playlistId === pl.id && playing.clipId === clip.id
          const dropCls = drop?.id === clip.id ? (drop.before ? ' drop-before' : ' drop-after') : ''
          return (
            <li key={clip.id} className="item-wrap">
              <div
                className={'item' + (isPlaying ? ' playing' : '') + (clip.error ? ' error' : '') + dropCls}
                draggable={!readOnly && memoEdit !== clip.id}
                onClick={() => play(pl.id, clip.id)}
                title={readOnly ? 'クリックで再生' : 'クリックで再生・ドラッグで並べ替え（左のプレイリスト名に落とすと移動）'}
                onDragStart={e => { dragId.current = clip.id; setDraggingClip({ playlistId: pl.id, clipId: clip.id }); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', clip.id) } catch { /* ignore */ } }}
                onDragEnd={() => { dragId.current = null; setDraggingClip(null); setDrop(null) }}
                onDragOver={(e: DragEvent<HTMLDivElement>) => {
                  if (!dragId.current || dragId.current === clip.id) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const r = e.currentTarget.getBoundingClientRect()
                  const before = e.clientY - r.top < r.height / 2
                  if (!drop || drop.id !== clip.id || drop.before !== before) setDrop({ id: clip.id, before })
                }}
                onDrop={e => {
                  e.preventDefault()
                  if (!dragId.current || dragId.current === clip.id) return
                  const r = e.currentTarget.getBoundingClientRect()
                  onDropOn(clip, e.clientY - r.top < r.height / 2)
                  dragId.current = null
                  setDrop(null)
                }}
              >
                <div className="idx">{isPlaying ? '♪' : idx + 1}</div>
                <div className="thumb-wrap">
                  <img className="thumb" src={thumbUrl(clip.videoId)} alt="" loading="lazy" draggable={false} />
                  <span className="thumb-badge">{clip.more?.length
                    ? (() => { const tl = totalLength(clip, clip.duration ?? null); return tl != null ? fmtDuration(tl) : `${clip.more.length + 1}区間` })()
                    : clip.end != null ? fmtDuration(clip.end - clip.start) : (clip.start ? `${fmtTime(clip.start, false)}〜` : '全体')}</span>
                </div>
                <div className="meta">
                  {/* 動画名は投稿者が付けたものなのでそのまま出し、自分のメモは下の行に分ける */}
                  <div className="title">{clip.title || clip.videoId}</div>
                  <div className="sub">
                    {clip.more?.length ? (
                      <span className="range segs">{segmentsOf(clip).map((g, i) => (
                        <button key={i} type="button" className={'seg-pill' + (g.disabled ? ' off' : '')} style={{ '--seg': segColor(g, i) } as CSSProperties}
                          title={g.disabled ? `区間 ${i + 1}: 無効（タップで有効にする）` : `区間 ${i + 1}: 有効（タップで無効にする＝一時的に再生しない）`}
                          onClick={e => { e.stopPropagation(); toggleSegmentDisabled(pl.id, clip.id, i) }}>
                          {fmtTime(g.start, false)}–{g.end != null ? fmtTime(g.end, false) : '最後'}
                        </button>
                      ))}</span>
                    ) : (
                      <span className="range">{clip.end != null || clip.start ? `${fmtTime(clip.start)} → ${clip.end != null ? fmtTime(clip.end) : '最後'}` : '動画全体'}</span>
                    )}
                    {clip.author && <span className="author">{clip.author}</span>}
                    {clip.error && <span className="err">⚠ {clip.error}</span>}
                    {!clip.title && !clip.error && <span className="author">取得中…</span>}
                  </div>
                  <div className="clip-memo-row" onClick={e => e.stopPropagation()}>
                    {memoEdit === clip.id ? (
                      <input className="clip-memo-in" autoFocus value={clip.label} maxLength={200} placeholder="メモ（例: サビ、練習ポイント）"
                        onChange={e => updateClip(pl.id, clip.id, { label: e.target.value })}
                        onBlur={() => setMemoEdit(null)}
                        onKeyDown={e => { if (isComposing(e)) return; if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }} />
                    ) : (
                      <span className={'clip-memo' + (clip.label ? '' : ' empty')} onClick={() => setMemoEdit(clip.id)}
                        title="タップ（クリック）でメモを編集">{clip.label || '＋ メモ'}</span>
                    )}
                  </div>
                </div>
                <div className="actions" onClick={e => e.stopPropagation()}>
                  {!readOnly && <>
                  <button title="区間・メモを編集" className={editing?.clipId === clip.id ? 'on' : ''} onClick={() => (editing?.clipId === clip.id ? closeClipEditor(false) : openClipEditor(pl.id, clip.id, false))}>✎</button>
                  <button title="同じ動画から別の区間を追加" onClick={() => addClipFromSameVideo(pl.id, clip)}>＋</button>
                  <button title="上へ" onClick={() => moveClip(pl.id, idx, idx - 1)} disabled={idx === 0}>↑</button>
                  <button title="下へ" onClick={() => moveClip(pl.id, idx, idx + 1)} disabled={idx === pl.items.length - 1}>↓</button>
                  </>}
                  <button title="YouTube で開く" onClick={() => window.api.openExternal(watchUrl(clip.videoId, clip.start))}>↗</button>
                  {!readOnly && <button className="del" title="削除" onClick={() => onRemove(clip)}>✕</button>}
                </div>
              </div>
              {editing?.clipId === clip.id && <RangeEditor pl={pl} clip={clip} isNew={editing.isNew} />}
            </li>
          )
        })}
      </ol>
    </>
  )
}
