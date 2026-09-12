import type { JSX } from 'react'
import { LIBRARY_ID } from '@shared/types'
import { getCurrentPlaylist, getPlayingClip, getPlayingPlaylist, useStore } from '../store'
import { fmtDuration, fmtTime } from '../time'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * プレーヤー直下の区間バー: 動画全体に対する区間の位置を描画する
 *  - 赤: 再生中の区間　- 薄い白: 同じ動画の他のクリップ　- 黄の点線: マーク中の仮の区間　- 白線: 現在位置
 */
export default function PlayerOverlay(): JSX.Element | null {
  const clip = useStore(getPlayingClip)
  const playingPl = useStore(getPlayingPlaylist)
  const targetPl = useStore(getCurrentPlaylist)
  const currentTime = useStore(s => s.currentTime)
  const loadedDuration = useStore(s => s.duration)
  const marks = useStore(s => s.marks)
  const fromLib = useStore(s => s.playing?.playlistId === LIBRARY_ID)

  if (!clip) return null
  const dur = clip.duration ?? (loadedDuration > 0 ? loadedDuration : null)
  if (!dur || dur <= 0) return null
  const pct = (t: number): number => clamp((t / dur) * 100, 0, 100)

  const start = clip.start
  const end = clip.end ?? dur
  const isWhole = clip.start === 0 && clip.end == null
  // 同じ動画の他のクリップ（ライブラリからのプレビュー中は追加先プレイリストのもの）
  const srcPl = fromLib ? targetPl : playingPl
  const others = (srcPl?.items ?? []).filter(c => c.videoId === clip.videoId && c.id !== clip.id)
  const hasMark = marks.start != null || marks.end != null
  const mStart = marks.start ?? start
  const mEnd = marks.end ?? Math.min(dur, Math.max(mStart + 0.5, currentTime))

  const labelLeft = clamp(pct(start), 0, 82)
  return (
    <div className="player-overlay" aria-hidden="true">
      <div className="po-track">
        {others.map(c => (
          <div key={c.id} className="po-other" style={{ left: `${pct(c.start)}%`, width: `${Math.max(pct(c.end ?? dur) - pct(c.start), 0.4)}%` }} />
        ))}
        {!isWhole && <div className="po-range" style={{ left: `${pct(start)}%`, width: `${Math.max(pct(end) - pct(start), 0.4)}%` }} />}
        {hasMark && <div className="po-mark" style={{ left: `${pct(mStart)}%`, width: `${Math.max(pct(mEnd) - pct(mStart), 0.4)}%` }} />}
        <div className="po-head" style={{ left: `${pct(currentTime)}%` }} />
      </div>
      <div className={"po-labels" + (hasMark && !isWhole ? " two" : "")}>
        {!isWhole && (
          <span className="po-label po-label-range" style={{ left: `${labelLeft}%` }}>
            {fmtTime(start)} → {clip.end != null ? fmtTime(clip.end) : '最後'}　({fmtDuration(end - start)})
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
