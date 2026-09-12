import type { JSX } from 'react'
import { getPlayingClip, getPlayingPlaylist, useStore } from '../store'
import { next, prev, togglePlay } from '../player'
import { handleCommand } from '../commands'
import { fmtTime } from '../time'

export default function NowBar(): JSX.Element {
  const clip = useStore(getPlayingClip)
  const pl = useStore(getPlayingPlaylist)
  const isPlaying = useStore(s => s.isPlaying)
  const t = useStore(s => s.currentTime)
  const shuffle = useStore(s => s.settings.shuffle)
  const loop = useStore(s => s.settings.loop)
  const mini = useStore(s => s.settings.miniPlayer)
  const top = useStore(s => s.settings.alwaysOnTop)
  const isWeb = useStore(s => s.isWeb)
  const idx = clip && pl ? pl.items.findIndex(c => c.id === clip.id) + 1 : 0
  const title = clip ? clip.label || clip.title || clip.videoId : '—'

  return (
    <div className="now-bar">
      <div className="now-text">
        <div className="now-title" title={clip ? clip.title : ''}>{title}</div>
        <div className="now-sub">
          {clip && pl ? `${pl.name}　${idx} / ${pl.items.length}` + (clip.author ? `　·　${clip.author}` : '') : 'クリップを選んでください'}
        </div>
      </div>
      {clip && !mini && (
        <div className="now-time">
          <span className="cur">{fmtTime(t)}</span>
          <span className="range">区間 {fmtTime(clip.start)} → {clip.end != null ? fmtTime(clip.end) : '最後'}</span>
        </div>
      )}
      <div className="controls">
        <button className="ctrl" onClick={prev} title="前のクリップ (←)">⏮</button>
        <button className="ctrl ctrl-main" onClick={togglePlay} title="再生 / 一時停止 (Space)">{isPlaying ? '⏸' : '▶'}</button>
        <button className="ctrl" onClick={next} title="次のクリップ (→)">⏭</button>
        {!mini && (
          <>
            <button className={'ctrl toggle' + (shuffle ? ' on' : '')} onClick={() => handleCommand('toggle-shuffle')} title="シャッフル">🔀</button>
            <button className={'ctrl toggle' + (loop !== 'off' ? ' on' : '')} onClick={() => handleCommand('cycle-loop')}
              title={{ off: 'リピート: オフ', all: 'リピート: 全曲', one: 'リピート: 1曲（区間）' }[loop]}>
              🔁{loop === 'one' && <span className="one">1</span>}
            </button>
          </>
        )}
        {!isWeb && <button className={'ctrl toggle' + (top ? ' on' : '')} onClick={() => handleCommand('toggle-top')} title="常に最前面 (Command + Shift + T)">📌</button>}
        {!isWeb && <button className={'ctrl toggle' + (mini ? ' on' : '')} onClick={() => handleCommand('toggle-mini')} title="ミニプレーヤー (Command + Shift + M)">⧉</button>}
        {!mini && !isWeb && <button className="ctrl" onClick={() => handleCommand('settings')} title="設定 (Command + ,)">⚙</button>}
      </div>
    </div>
  )
}
