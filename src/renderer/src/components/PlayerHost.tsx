import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { mountPlayer } from '../player'
import { useStore } from '../store'
import PlayerOverlay from './PlayerOverlay'
import { useIsMobile } from '../useIsMobile'

export default function PlayerHost(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const hasPlaying = useStore(s => !!s.playing)
  const isMobile = useIsMobile()
  const mini = useStore(s => s.settings.miniPlayer)
  const h = useStore(s => s.settings.playerHeight)
  const readOnly = useStore(s => s.readOnly)
  const style = h != null && !isMobile && !mini ? { height: h, width: 'auto', maxWidth: '100%', aspectRatio: '16 / 9', maxHeight: 'calc(100vh - 300px)', minHeight: 120 } : undefined
  useEffect(() => { if (ref.current) mountPlayer(ref.current) }, [])
  return (
    <>
    <div className="player-wrap" style={style}>
      <div ref={ref} className="player-el" />
      {!hasPlaying && (
        <div className="placeholder">
          <div className="placeholder-icon">▶</div>
          {readOnly ? (
            <div>リストのクリップを押すと、その区間から再生します。</div>
          ) : (
            <div>
              下の欄に YouTube の URL を貼り付けて「追加」。<br />
              リストのクリップをクリックすると、その区間から再生します。
            </div>
          )}
        </div>
      )}
    </div>
    <PlayerOverlay />
    </>
  )
}
