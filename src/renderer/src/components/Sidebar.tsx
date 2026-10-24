import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { moveClipToPlaylist, movePlaylist, toggleChain, newPlaylist, renamePlaylist, setView, switchPlaylist, toast, useStore } from '../store'
import { getDraggingClip, setDraggingClip } from '../dnd'
import { handleCommand } from '../commands'
import { LIBRARY_ID } from '@shared/types'
import HistoryPanel from './HistoryPanel'
import { isComposing } from '../ime'

export default function Sidebar(): JSX.Element {
  const tab = useStore(s => s.sidebarTab)
  const readOnly = useStore(s => s.readOnly)
  return (
    <aside className="sidebar">
      <div className="brand drag"><span className="logo">▶</span> ShuffleTube</div>
      <div className="tabs">
        <button className={tab === 'lists' ? 'on' : ''} onClick={() => useStore.setState({ sidebarTab: 'lists' })}>リスト</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => useStore.setState({ sidebarTab: 'history' })}>履歴</button>
      </div>
      {tab === 'lists' ? <PlaylistNav /> : <HistoryPanel />}
      <div className="sidebar-tools">
        <button className="text-btn" onClick={() => handleCommand('export')}>書き出し (JSON)</button>
        {!readOnly && <button className="text-btn" onClick={() => handleCommand('import')}>読み込み (JSON)</button>}
      </div>
      <div className="help">
        <div>Space: 再生 / 一時停止　← →: 前 / 次</div>
        <div>Command + [ / ]: 開始点 / 終了点　Command + Enter: 区間追加</div>
      </div>
    </aside>
  )
}

function PlaylistNav(): JSX.Element {
  const playlists = useStore(s => s.playlists)
  const currentId = useStore(s => s.settings.currentPlaylistId)
  const view = useStore(s => s.settings.view)
  const playingId = useStore(s => s.playing?.playlistId ?? null)
  const libCount = useStore(s => s.library.length)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [dropId, setDropId] = useState<string | null>(null)
  // プレイリスト自体の並べ替え（曲のドラッグとは別）
  const plDrag = useRef<string | null>(null)
  const [plDrop, setPlDrop] = useState<{ id: string; before: boolean } | null>(null)
  const endPlDrag = (): void => { plDrag.current = null; setPlDrop(null) }
  const onPlDrop = (targetId: string, before: boolean): void => {
    const from = playlists.findIndex(p => p.id === plDrag.current)
    let to = playlists.findIndex(p => p.id === targetId)
    if (from < 0 || to < 0) return
    if (!before) to++
    if (from < to) to--
    movePlaylist(from, to)
  }
  const draggingFrom = useStore(s => s.draggingFrom)
  const readOnly = useStore(s => s.readOnly)
  // ドラッグ中、プレイリスト名の外に出たら移動先の表示を消す（dragleave は子要素の出入りでも飛ぶため使わない）
  useEffect(() => {
    if (!draggingFrom) { setDropId(null); return }
    const onOver = (e: DragEvent): void => {
      if (!(e.target as Element | null)?.closest?.('[data-drop-pl]')) setDropId(null)
    }
    document.addEventListener('dragover', onOver)
    return () => document.removeEventListener('dragover', onOver)
  }, [draggingFrom])
  const cancelled = useRef(false)
  const startEdit = (id: string, name: string): void => { cancelled.current = false; setEditName(name); setEditId(id) }
  const commitEdit = (): void => {
    if (editId && !cancelled.current && editName.trim()) renamePlaylist(editId, editName)
    setEditId(null)
  }
  return (
    <>
      <ul className="playlist-list lib-nav">
        <li className={'lib-entry ' + (view === 'library' ? 'active ' : '') + (playingId === LIBRARY_ID ? 'playing' : '')} onClick={() => setView('library')} title="動画の保管庫 (Command + Shift + L)">
          <span className="pl-name">📚 ライブラリ</span>
          <span className="pl-count">{libCount}</span>
        </li>
      </ul>
      <div className="section-title">
        <span>プレイリスト</span>
        {!readOnly && <button className="icon-btn" title="新しいプレイリスト (Command + N)" onClick={() => { newPlaylist(); useStore.setState({ focusNameInput: Date.now() }) }}>＋</button>}
      </div>
      <ul className={'playlist-list' + (draggingFrom ? ' dragging' : '')}>
        {playlists.map(pl => (
          <li key={pl.id} data-drop-pl={pl.id}
            className={(view === 'playlist' && pl.id === currentId ? 'active ' : '') + (pl.id === playingId ? 'playing ' : '')
              + (draggingFrom && draggingFrom !== pl.id ? 'can-drop ' : '') + (dropId === pl.id ? 'drop-target ' : '')
              + (plDrop?.id === pl.id ? (plDrop.before ? 'pl-drop-before' : 'pl-drop-after') : '')}
            draggable={!readOnly && editId !== pl.id}
            onDragStart={e => {
              plDrag.current = pl.id
              e.dataTransfer.effectAllowed = 'move'
              try { e.dataTransfer.setData('text/plain', pl.name) } catch { /* ignore */ }
            }}
            onDragEnd={endPlDrag}
            onClick={() => { if (editId !== pl.id) switchPlaylist(pl.id) }}
            onDoubleClick={() => { if (!readOnly) startEdit(pl.id, pl.name) }}
            title={readOnly ? '' : 'ドラッグで並べ替え。ダブルクリックで名前を変更。クリップをここにドロップすると、このプレイリストへ移動します'}
            onDragOver={e => {
              if (plDrag.current) {
                if (plDrag.current === pl.id) { if (plDrop) setPlDrop(null); return }
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const r = e.currentTarget.getBoundingClientRect()
                const before = e.clientY - r.top < r.height / 2
                if (plDrop?.id !== pl.id || plDrop.before !== before) setPlDrop({ id: pl.id, before })
                return
              }
              const d = getDraggingClip()
              if (!d || d.playlistId === pl.id) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dropId !== pl.id) setDropId(pl.id)
            }}
            onDrop={e => {
              e.preventDefault()
              if (plDrag.current) {
                const r = e.currentTarget.getBoundingClientRect()
                if (plDrag.current !== pl.id) onPlDrop(pl.id, e.clientY - r.top < r.height / 2)
                endPlDrag()
                return
              }
              setDropId(null)
              const d = getDraggingClip()
              setDraggingClip(null)
              if (!d || d.playlistId === pl.id) return
              toast(moveClipToPlaylist(d.playlistId, d.clipId, pl.id) ? `「${pl.name}」へ移動しました` : `「${pl.name}」に同じ区間があるため移動しませんでした`)
            }}
          >
            {editId === pl.id ? (
              <input className="pl-name-in" autoFocus value={editName} maxLength={60}
                onFocus={e => e.target.select()}
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
                onChange={e => setEditName(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => {
                  if (isComposing(e)) return
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  else if (e.key === 'Escape') { cancelled.current = true; setEditId(null) }
                }} />
            ) : (
              <span className="pl-name">{pl.name}</span>
            )}
            {dropId === pl.id
              ? <span className="pl-drop-hint">ここへ移動</span>
              : <>
                <button type="button" className={'pl-chain' + (pl.chain ? ' on' : '')} draggable={false}
                  title={pl.chain ? 'またいで再生: ON（最後まで行ったら次の ON のリストへ続ける）。クリックで OFF' : 'またいで再生: OFF（このリストの中だけ）。クリックで ON'}
                  onClick={e => { e.stopPropagation(); toggleChain(pl.id) }} onDoubleClick={e => e.stopPropagation()}>
                  <span className="pl-chain-knob" />
                </button>
                <span className="pl-count">{pl.items.length}</span>
              </>}
          </li>
        ))}
      </ul>
    </>
  )
}
