import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { mountPlayer } from '../player'
import { useStore } from '../store'
import PlayerOverlay from './PlayerOverlay'

export default function PlayerHost(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const hasPlaying = useStore(s => !!s.playing)
  useEffect(() => { if (ref.current) mountPlayer(ref.current) }, [])
  return (
    <>
    <div className="player-wrap">
      <div ref={ref} className="player-el" />
      {!hasPlaying && (
        <div className="placeholder">
          <div className="placeholder-icon">▶</div>
          <div>
            下の欄に YouTube の URL を貼り付けて「追加」。<br />
            リストのクリップをクリックすると、その区間から再生します。
          </div>
        </div>
      )}
    </div>
    <PlayerOverlay />
    </>
  )
}
