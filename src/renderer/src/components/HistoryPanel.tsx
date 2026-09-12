import type { JSX } from 'react'
import type { HistoryEntry } from '@shared/types'
import { addClips, clearHistory, getCurrentPlaylist, makeClip, removeHistory, toast, useStore } from '../store'
import { play } from '../player'
import { fmtTime } from '../time'

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function HistoryPanel(): JSX.Element {
  const history = useStore(s => s.history)
  const enabled = useStore(s => s.settings.history)

  const playEntry = (h: HistoryEntry): void => {
    const s = useStore.getState()
    const pl = getCurrentPlaylist(s)
    if (!pl) return
    let clip = pl.items.find(c => c.videoId === h.videoId && c.start === h.start && c.end === h.end)
    if (!clip) {
      const c = makeClip(h.videoId, h.start, h.end)
      c.title = h.title; c.author = h.author
      addClips(pl.id, [c])
      clip = c
      toast(`「${pl.name}」に追加して再生します`)
    }
    play(pl.id, clip.id)
  }

  return (
    <>
      <div className="section-title">
        <span>視聴履歴{!enabled && '（記録オフ）'}</span>
        {history.length > 0 && <button className="icon-btn" title="履歴を全て消去" onClick={() => { if (window.confirm('視聴履歴を全て消去しますか？')) clearHistory() }}>🗑</button>}
      </div>
      <ul className="history-list">
        {history.length === 0 && <li className="empty small">まだ履歴がありません</li>}
        {history.map(h => (
          <li key={h.id} onClick={() => playEntry(h)} title={h.title}>
            <div className="h-title">{h.title || h.videoId}</div>
            <div className="h-sub">
              <span>{h.end != null || h.start ? `${fmtTime(h.start)} → ${h.end != null ? fmtTime(h.end) : '最後'}` : '全体'}</span>
              <span className="h-date">{fmtDate(h.playedAt)}</span>
            </div>
            <button className="h-del" title="この履歴を削除" onClick={e => { e.stopPropagation(); removeHistory(h.id) }}>✕</button>
          </li>
        ))}
      </ul>
    </>
  )
}
