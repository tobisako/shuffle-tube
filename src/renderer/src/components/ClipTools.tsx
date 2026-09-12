import type { JSX } from 'react'
import { getCurrentPlaylist, getPlayingClip, useStore } from '../store'
import { LIBRARY_ID } from '@shared/types'
import { clearMarks, markEnd, markStart } from '../player'
import { handleCommand } from '../commands'
import { fmtTime } from '../time'

export default function ClipTools(): JSX.Element | null {
  const clip = useStore(getPlayingClip)
  const marks = useStore(s => s.marks)
  const fromLib = useStore(s => s.playing?.playlistId === LIBRARY_ID)
  const target = useStore(getCurrentPlaylist)
  if (!clip) return null
  const hasMark = marks.start != null || marks.end != null
  return (
    <div className="clip-tools">
      <span className="ct-label">区間マーク</span>
      <button className="mark-btn" onClick={markStart} title="現在位置を開始点にする (Command + [)">
        ⏺ 開始点 <b>{marks.start != null ? fmtTime(marks.start) : '—'}</b>
      </button>
      <button className="mark-btn" onClick={markEnd} title="現在位置を終了点にする (Command + ])">
        ⏹ 終了点 <b>{marks.end != null ? fmtTime(marks.end) : '—'}</b>
      </button>
      <button className="primary small" disabled={!hasMark} onClick={() => handleCommand('add-clip')} title="Command + Enter">
        ＋ この区間をクリップとして追加{fromLib && target ? `（→ ${target.name}）` : ''}
      </button>
      {hasMark && <button className="text-btn small" onClick={clearMarks}>クリア</button>}
      <span className="ct-hint">再生しながら開始点・終了点を押すと、同じ動画から別の区間をいくつでも作れます</span>
    </div>
  )
}
