import type { Command } from '@shared/types'
import { addClipsAfterPlaying, exportJson, importJson } from './actions'
import { addClipFromMarks, clearMarks, closeClipEditor, markEnd, markStart, next, prev, togglePlay } from './player'
import { newPlaylist, setView, toast, updateSettings, useStore } from './store'
import { fmtTime } from './time'

export function handleCommand(cmd: Command): void {
  const s = useStore.getState()
  switch (cmd) {
    case 'play-pause': togglePlay(); break
    case 'next': next(); break
    case 'prev': prev(); break
    case 'new-playlist': {
      if (s.settings.miniPlayer) updateSettings({ miniPlayer: false })
      newPlaylist()
      useStore.setState({ sidebarTab: 'lists', focusNameInput: Date.now() })
      break
    }
    case 'focus-url': {
      if (s.settings.miniPlayer) updateSettings({ miniPlayer: false })
      window.setTimeout(() => { (document.getElementById('input-url') as HTMLInputElement | null)?.focus() }, 50)
      break
    }
    case 'toggle-mini': updateSettings({ miniPlayer: !s.settings.miniPlayer }); break
    case 'toggle-top':
      updateSettings({ alwaysOnTop: !s.settings.alwaysOnTop })
      toast(!s.settings.alwaysOnTop ? '常に最前面: オン' : '常に最前面: オフ')
      break
    case 'toggle-shuffle':
      updateSettings({ shuffle: !s.settings.shuffle })
      toast(!s.settings.shuffle ? 'シャッフル: オン' : 'シャッフル: オフ')
      break
    case 'cycle-loop': {
      const nextLoop = ({ off: 'all', all: 'one', one: 'off' } as const)[s.settings.loop]
      updateSettings({ loop: nextLoop })
      toast({ off: 'リピート: オフ', all: 'リピート: 全曲', one: 'リピート: 1曲（区間）' }[nextLoop])
      break
    }
    case 'settings': useStore.setState({ settingsOpen: !s.settingsOpen }); break
    case 'export': exportJson(); break
    case 'import': importJson(); break
    case 'mark-start': markStart(); break
    case 'mark-end': markEnd(); break
    case 'add-clip': {
      const c = addClipFromMarks()
      if (!c) break
      const { added, target } = addClipsAfterPlaying([c])
      if (added) { toast(`「${target}」に区間 ${fmtTime(c.start)} → ${c.end != null ? fmtTime(c.end) : '最後'} を追加しました`); clearMarks() }
      else toast('同じ区間が既にあります')
      break
    }
    case 'show-library': {
      if (s.settings.miniPlayer) updateSettings({ miniPlayer: false })
      setView(s.settings.view === 'library' ? 'playlist' : 'library')
      break
    }
  }
}

/** キーボード（入力欄にフォーカスがある時は無効） */
export function handleKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.code === 'Space') { e.preventDefault(); togglePlay() }
  else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
  else if (e.key === 'Escape') { useStore.setState({ settingsOpen: false }); closeClipEditor(false) }
}
