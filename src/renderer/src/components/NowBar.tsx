import type { CSSProperties, JSX } from 'react'
import { useRef } from 'react'
import { getPlayingClip, getPlayingPlaylist, useStore } from '../store'
import { next, prev, setVolume, togglePlay } from '../player'
import { useIsMobile } from '../useIsMobile'
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
  const volume = useStore(s => s.settings.volume)
  const isMobile = useIsMobile()
  const beforeMute = useRef(50)
  const idx = clip && pl ? pl.items.findIndex(c => c.id === clip.id) + 1 : 0
  // 動画名は投稿者が付けたものなのでそのまま出し、自分のメモは下の行に添える
  const title = clip ? clip.title || clip.videoId : '—'

  return (
    <div className="now-bar">
      <div className="now-text">
        <div className="now-title" title={clip ? clip.title : ''}>{title}</div>
        <div className="now-sub">
          {clip && pl ? `${pl.name}　${idx} / ${pl.items.length}` + (clip.author ? `　·　${clip.author}` : '') : 'クリップを選んでください'}
        </div>
        {clip?.label && <div className="now-memo" title={clip.label}>📝 {clip.label}</div>}
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
        {!mini && !isMobile && (
          <div className="volume" title={`音量 ${volume}`}>
            <button className="vol-btn" title={volume ? '消音' : '消音を解除'}
              onClick={() => { if (volume) { beforeMute.current = volume; setVolume(0) } else setVolume(beforeMute.current || 50) }}>
              {volume === 0 ? '🔇' : volume < 40 ? '🔈' : volume < 75 ? '🔉' : '🔊'}
            </button>
            <input type="range" min={0} max={100} step={1} value={volume}
              style={{ '--vol': `${volume}%` } as CSSProperties}
              onChange={e => setVolume(Number(e.target.value))} />
            <span className="vol-num">{volume}</span>
          </div>
        )}
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
