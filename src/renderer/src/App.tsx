import type { JSX } from 'react'
import { useEffect } from 'react'
import { initStore, useStore } from './store'
import { handleCommand, handleKeydown } from './commands'
import Sidebar from './components/Sidebar'
import PlayerHost from './components/PlayerHost'
import NowBar from './components/NowBar'
import ClipTools from './components/ClipTools'
import AddBar from './components/AddBar'
import ItemList from './components/ItemList'
import LibraryView from './components/LibraryView'
import HistoryPanel from './components/HistoryPanel'
import MobileNav from './components/MobileNav'
import { useIsMobile } from './useIsMobile'
import SettingsDialog from './components/SettingsDialog'
import Toast from './components/Toast'

export default function App(): JSX.Element {
  const loaded = useStore(s => s.loaded)
  const mini = useStore(s => s.settings.miniPlayer)
  const view = useStore(s => s.settings.view)
  const settingsOpen = useStore(s => s.settingsOpen)
  const mobileTab = useStore(s => s.mobileTab)
  const isMobile = useIsMobile()

  useEffect(() => {
    initStore().catch(e => console.error('init failed', e))
    const off = window.api.onCommand(handleCommand)
    document.addEventListener('keydown', handleKeydown)
    return () => { off(); document.removeEventListener('keydown', handleKeydown) }
  }, [])

  if (!loaded) return <div className="loading">読み込み中…</div>

  if (isMobile) {
    return (
      <div className="app mobile">
        <main className="main">
          <PlayerHost />
          <NowBar />
          {mobileTab !== 'history' && <ClipTools />}
          {mobileTab !== 'history' && <AddBar />}
          {mobileTab === 'playlist' && <ItemList />}
          {mobileTab === 'library' && <LibraryView />}
          {mobileTab === 'history' && <div className="mobile-history"><HistoryPanel /></div>}
        </main>
        <MobileNav />
        {settingsOpen && <SettingsDialog />}
        <Toast />
        <div id="import-player-holder" className="offscreen" />
      </div>
    )
  }

  return (
    <div className={'app' + (mini ? ' mini' : '')}>
      {!mini && <Sidebar />}
      <main className="main">
        {mini && <div className="mini-drag drag" />}
        <PlayerHost />
        <NowBar />
        {!mini && <ClipTools />}
        {!mini && <AddBar />}
        {!mini && (view === 'library' ? <LibraryView /> : <ItemList />)}
      </main>
      {settingsOpen && <SettingsDialog />}
      <Toast />
      <div id="import-player-holder" className="offscreen" />
    </div>
  )
}
