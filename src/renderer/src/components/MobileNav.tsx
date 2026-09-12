import type { JSX } from 'react'
import { setView, useStore } from '../store'

/** スマホ表示の下部タブ */
export default function MobileNav(): JSX.Element {
  const tab = useStore(s => s.mobileTab)
  const libCount = useStore(s => s.library.length)
  const go = (t: 'playlist' | 'library' | 'history'): void => {
    useStore.setState({ mobileTab: t })
    if (t === 'playlist') setView('playlist')
    if (t === 'library') setView('library')
  }
  return (
    <nav className="mobile-nav">
      <button className={tab === 'playlist' ? 'on' : ''} onClick={() => go('playlist')}><span>♪</span>プレイリスト</button>
      <button className={tab === 'library' ? 'on' : ''} onClick={() => go('library')}><span>📚</span>ライブラリ{libCount ? ` (${libCount})` : ''}</button>
      <button className={tab === 'history' ? 'on' : ''} onClick={() => go('history')}><span>🕘</span>履歴</button>
      <button onClick={() => useStore.setState({ settingsOpen: true })}><span>⚙</span>設定</button>
    </nav>
  )
}
