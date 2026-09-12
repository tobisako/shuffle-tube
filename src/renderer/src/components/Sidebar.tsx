import type { JSX } from 'react'
import { newPlaylist, setView, switchPlaylist, useStore } from '../store'
import { handleCommand } from '../commands'
import { LIBRARY_ID } from '@shared/types'
import HistoryPanel from './HistoryPanel'

export default function Sidebar(): JSX.Element {
  const tab = useStore(s => s.sidebarTab)
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
        <button className="text-btn" onClick={() => handleCommand('import')}>読み込み (JSON)</button>
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
        <button className="icon-btn" title="新しいプレイリスト (Command + N)" onClick={() => { newPlaylist(); useStore.setState({ focusNameInput: Date.now() }) }}>＋</button>
      </div>
      <ul className="playlist-list">
        {playlists.map(pl => (
          <li key={pl.id} className={(view === 'playlist' && pl.id === currentId ? 'active ' : '') + (pl.id === playingId ? 'playing' : '')} onClick={() => switchPlaylist(pl.id)}>
            <span className="pl-name">{pl.name}</span>
            <span className="pl-count">{pl.items.length}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
