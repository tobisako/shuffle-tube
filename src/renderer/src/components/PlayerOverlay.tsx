import type { JSX } from 'react'
import { LIBRARY_ID } from '@shared/types'
import { getCurrentPlaylist, getPlayingClip, getPlayingPlaylist, useStore } from '../store'
import { fmtDuration, fmtTime } from '../time'
import { segColor, segmentLanes, segmentsOf } from '../segments'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useRef } from 'react'
import { seekTo, setScrubbing } from '../player'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * プレーヤー直下の区間バー: 動画全体に対する区間の位置を描画する
 *  - クリック・ドラッグでその位置へ移る
 *  - 色付き: 再生中のクリップの区間（区間ごとの色）　- 薄い白: 同じ動画の他のクリップ　- 黄の点線: マーク中の仮の区間　- 白線: 現在位置
 */
export default function PlayerOverlay(): JSX.Element | null {
  const clip = useStore(getPlayingClip)
  const playingPl = useStore(getPlayingPlaylist)
  const targetPl = useStore(getCurrentPlaylist)
  const currentTime = useStore(s => s.currentTime)
  const loadedDuration = useStore(s => s.duration)
  const marks = useStore(s => s.marks)
  const fromLib = useStore(s => s.playing?.playlistId === LIBRARY_ID)
  const drag = useRef<{ last: number } | null>(null)
  const playingSeg = useStore(s => s.playingSeg)

  if (!clip) return null
  const dur = clip.duration ?? (loadedDuration > 0 ? loadedDuration : null)
  if (!dur || dur <= 0) return null
  const pct = (t: number): number => clamp((t / dur) * 100, 0, 100)

  const segs = segmentsOf(clip)
  // ラベルに出すのは、いま流している区間（分からなければ再生位置がある区間、どれにも入っていなければ 1 つ目）
  const curIdx = playingSeg >= 0 && playingSeg < segs.length ? playingSeg
    : Math.max(0, segs.findIndex(g => currentTime >= g.start - 0.3 && currentTime <= (g.end ?? dur) + 0.3))
  // 区間が重なるときは上下の段に分けて描く（段が増えるほどバーを太くする）
  const lanes = segmentLanes(segs, dur)
  const cur = segs[curIdx]
  const start = cur.start
  const end = cur.end ?? dur
  const isWhole = segs.length === 1 && clip.start === 0 && clip.end == null
  // 同じ動画の他のクリップ（ライブラリからのプレビュー中は追加先プレイリストのもの）
  const srcPl = fromLib ? targetPl : playingPl
  const others = (srcPl?.items ?? []).filter(c => c.videoId === clip.videoId && c.id !== clip.id)
  const hasMark = marks.start != null || marks.end != null
  const mStart = marks.start ?? start
  const mEnd = marks.end ?? Math.min(dur, Math.max(mStart + 0.5, currentTime))

  const labelLeft = clamp(pct(start), 0, 82)
  const timeAt = (e: ReactPointerEvent<HTMLDivElement>): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return clamp((e.clientX - r.left) / r.width, 0, 1) * dur
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { last: Date.now() }
    setScrubbing(true)
    seekTo(timeAt(e), false)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current || Date.now() - drag.current.last < 80) return
    drag.current.last = Date.now()
    seekTo(timeAt(e), false)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    drag.current = null
    seekTo(timeAt(e), true)
    window.setTimeout(() => setScrubbing(false), 300)
  }
  return (
    <div className="player-overlay">
      <div className="po-hit" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        title="クリック・ドラッグでその位置へ移動">
      <div className="po-track" style={lanes.count > 1 ? { height: lanes.count * 5 + 2 } : undefined}>
        {others.map(c => (
          <div key={c.id} className="po-other" style={{ left: `${pct(c.start)}%`, width: `${Math.max(pct(c.end ?? dur) - pct(c.start), 0.4)}%` }} />
        ))}
        {!isWhole && segs.map((g, i) => (
          <div key={i} className={'po-range' + (g.disabled ? ' off' : '') + (i === curIdx ? ' cur' : '')} style={{
            left: `${pct(g.start)}%`, width: `${Math.max(pct(g.end ?? dur) - pct(g.start), 0.4)}%`, '--seg': segColor(g, i),
            ...(lanes.count > 1 ? { top: `${(lanes.lane[i] * 100) / lanes.count}%`, height: `calc(${100 / lanes.count}% - 1px)`, bottom: 'auto' } : {}),
          } as CSSProperties} />
        ))}
        {hasMark && <div className="po-mark" style={{ left: `${pct(mStart)}%`, width: `${Math.max(pct(mEnd) - pct(mStart), 0.4)}%` }} />}
        <div className="po-head" style={{ left: `${pct(currentTime)}%` }} />
      </div>
      </div>
      <div className={"po-labels" + (hasMark && !isWhole ? " two" : "")}>
        {!isWhole && (
          <span className="po-label po-label-range" style={{ left: `${labelLeft}%`, '--seg': segColor(cur, curIdx) } as CSSProperties}>
            {segs.length > 1 ? `区間 ${curIdx + 1}/${segs.length}　` : ''}{fmtTime(start)} → {cur.end != null ? fmtTime(cur.end) : '最後'}　({fmtDuration(end - start)})
          </span>
        )}
        {hasMark && (
          <span className="po-label po-label-mark" style={{ left: `${clamp(pct(mStart), 0, 82)}%`, top: isWhole ? 0 : 22 }}>
            マーク {marks.start != null ? fmtTime(marks.start) : '…'} → {marks.end != null ? fmtTime(marks.end) : '…'}
          </span>
        )}
        <span className="po-label po-label-time">{fmtTime(currentTime)} / {fmtTime(dur, false)}</span>
      </div>
    </div>
  )
}
