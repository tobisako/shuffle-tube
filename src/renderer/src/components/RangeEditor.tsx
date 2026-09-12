import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Clip, Playlist } from '@shared/types'
import { getPlayingClip, toast, updateClip, useStore } from '../store'
import { closeClipEditor, currentTimeOf, previewClip, seekPreview, setScrubbing } from '../player'
import { fmtDuration, fmtTime } from '../time'

const MIN_GAP = 0.5
const MIN_SPAN = 1          // これ以上は拡大しない（秒）
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const r1 = (v: number): number => Math.round(v * 10) / 10

/** 目盛りの間隔（表示幅に対して 4〜8 本になるように） */
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
function tickStep(span: number): number {
  for (const st of TICK_STEPS) if (span / st <= 8) return st
  return TICK_STEPS[TICK_STEPS.length - 1]
}

/**
 * 区間エディタ（GUI）
 *  - タイムライン上の 2 つのつまみ（開始 / 終了）をドラッグ
 *  - トラック上でホイール: カーソル位置を中心に連続的に拡大縮小。左右スクロールで表示範囲を移動
 *  - 動画の範囲外（0:00 より前 / 最後より後）は斜線の背景で描く
 *  - 「現在位置」ボタン、±1秒 / ±0.1秒 ボタン、「最後まで」スイッチ
 *  - 変更は即時反映（保存ボタン無し）
 */
export default function RangeEditor({ pl, clip, isNew }: { pl: Playlist; clip: Clip; isNew: boolean }): JSX.Element {
  const loadedDuration = useStore(s => s.duration)
  const currentTime = useStore(s => s.currentTime)
  const isLoaded = useStore(s => getPlayingClip(s)?.videoId === clip.videoId)
  const isPlaying = useStore(s => s.isPlaying)
  const trackRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<'start' | 'end' | null>(null)
  const lastSeek = useRef(0)
  useEffect(() => { rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [])

  const known = clip.duration ?? (isLoaded && loadedDuration > 0 ? loadedDuration : null)
  // 長さが未取得のときの全体幅。ドラッグでスケールが変わらないよう最初に一度だけ決める
  const [fallbackDur] = useState(() => Math.max((clip.end ?? clip.start) + 30, 60))
  const dur = known ?? fallbackDur
  const endOrDur = clip.end ?? dur

  // 表示範囲（秒）。区間には依存させず、ホイール操作でだけ変える。動画の範囲外にはみ出してよい
  const [win, setWin] = useState<[number, number]>(() => [0, dur])
  const winRef = useRef(win)
  winRef.current = win
  const durRef = useRef(dur)
  durRef.current = dur
  // 長さが後から判明したら全体表示に合わせ直す
  const knownRef = useRef(known)
  useEffect(() => {
    if (known != null && knownRef.current == null) setWin([0, known])
    knownRef.current = known
  }, [known])

  const span = Math.max(win[1] - win[0], 0.1)
  const toPct = (t: number): number => clamp(((t - win[0]) / span) * 100, 0, 100)
  const toPctRaw = (t: number): number => ((t - win[0]) / span) * 100
  const fromClientX = (x: number): number => {
    const r = trackRef.current!.getBoundingClientRect()
    return win[0] + clamp((x - r.left) / r.width, 0, 1) * span
  }

  // 表示範囲の制約: 動画が表示幅の 10% 以上は見えている範囲に収める
  const bounded = (n0: number, n1: number, d: number): [number, number] => {
    const ns = n1 - n0
    const margin = ns * 0.9
    if (n0 < -margin) { n0 = -margin; n1 = n0 + ns }
    if (n1 > d + margin) { n1 = d + margin; n0 = n1 - ns }
    return [n0, n1]
  }
  /** frac（0..1 の位置）の時刻を固定したまま表示幅を newSpan にする */
  const zoomAt = (frac: number, newSpan: number): void => {
    const [w0, w1] = winRef.current
    const d = durRef.current
    const sp = Math.max(w1 - w0, 0.1)
    const tAt = w0 + frac * sp
    const ns = clamp(newSpan, MIN_SPAN, d * 4)
    const n0 = tAt - frac * ns
    setWin(bounded(n0, n0 + ns, d))
  }

  // ホイール: 拡大縮小（deltaY）と移動（deltaX）。React の onWheel は passive なので生のリスナーで preventDefault する
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const [w0, w1] = winRef.current
      const d = durRef.current
      const sp = Math.max(w1 - w0, 0.1)
      const r = el.getBoundingClientRect()
      const frac = clamp((e.clientX - r.left) / r.width, 0, 1)
      if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        zoomAt(frac, sp * Math.exp(clamp(e.deltaY, -60, 60) * 0.003))
      } else {
        const dt = (e.deltaX / r.width) * sp
        setWin(bounded(w0 + dt, w1 + dt, d))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // タッチ: 2 本指ピンチで拡大縮小、1 本指の横ドラッグで移動、タップでシーク
  const pointers = useRef(new Map<number, number>())
  const gesture = useRef<{ mode: 'tap' | 'pan' | 'pinch'; startX: number; startWin: [number, number]; startDist: number; startSpan: number; midFrac: number } | null>(null)
  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.set(e.pointerId, e.clientX)
    e.currentTarget.setPointerCapture(e.pointerId)
    const r = e.currentTarget.getBoundingClientRect()
    if (pointers.current.size === 1) {
      gesture.current = { mode: 'tap', startX: e.clientX, startWin: winRef.current, startDist: 0, startSpan: 0, midFrac: 0 }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = {
        mode: 'pinch', startX: e.clientX, startWin: winRef.current,
        startDist: Math.max(Math.abs(a - b), 1), startSpan: winRef.current[1] - winRef.current[0],
        midFrac: clamp(((a + b) / 2 - r.left) / r.width, 0, 1),
      }
    }
  }
  const onTrackMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return
    pointers.current.set(e.pointerId, e.clientX)
    const g = gesture.current
    const r = e.currentTarget.getBoundingClientRect()
    if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.max(Math.abs(a - b), 1)
      zoomAt(g.midFrac, g.startSpan * (g.startDist / dist))
      return
    }
    const dx = e.clientX - g.startX
    if (g.mode === 'tap' && Math.abs(dx) > 8 && e.pointerType !== 'mouse') g.mode = 'pan'
    if (g.mode === 'pan') {
      const sp = g.startWin[1] - g.startWin[0]
      const dt = -(dx / r.width) * sp
      setWin(bounded(g.startWin[0] + dt, g.startWin[1] + dt, durRef.current))
    }
  }
  const onTrackUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    if (g && g.mode === 'tap' && pointers.current.size === 0) onTrackClick(e)
    if (pointers.current.size === 0) gesture.current = null
    else if (pointers.current.size === 1 && g) { g.mode = 'pan'; g.startX = [...pointers.current.values()][0]; g.startWin = winRef.current }
  }

  const setStart = (t: number, seek = true, final = true): void => {
    const v = r1(clamp(t, 0, endOrDur - MIN_GAP))
    if (v !== clip.start) updateClip(pl.id, clip.id, { start: v })
    if (seek && isLoaded) throttledSeek(v, final)
  }
  const setEnd = (t: number | null, seek = true, final = true): void => {
    if (t == null) { updateClip(pl.id, clip.id, { end: null }); return }
    const v = r1(clamp(t, clip.start + MIN_GAP, dur))
    if (v !== clip.end) updateClip(pl.id, clip.id, { end: v })
    if (seek && isLoaded) throttledSeek(v, final)
  }
  const throttledSeek = (t: number, final: boolean): void => {
    // 再生中は止めずに流し続ける（範囲だけ変わり、次の周回から反映）。止まっているときはそのフレームを表示
    if (useStore.getState().isPlaying) return
    const now = Date.now()
    if (!final && now - lastSeek.current < 80) return
    lastSeek.current = now
    seekPreview(t, final)
  }

  const onHandleDown = (which: 'start' | 'end') => (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = which
    setScrubbing(true)
  }
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    const t = clamp(fromClientX(e.clientX), 0, dur)
    if (dragging.current === 'start') setStart(t, true, false); else setEnd(t, true, false)
  }
  const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    const t = clamp(fromClientX(e.clientX), 0, dur)
    if (dragging.current === 'start') setStart(t, true, true); else setEnd(t, true, true)
    dragging.current = null
    window.setTimeout(() => setScrubbing(false), 300)
  }
  const onTrackClick = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!isLoaded) return
    const t = r1(fromClientX(e.clientX))
    // 区間の外（開始バーより前 / 終了バーより後）や動画の範囲外をクリックしたら開始バーの位置から
    const outside = t < clip.start || (clip.end != null && t > clip.end) || t < 0 || t > dur
    seekPreview(outside ? clip.start : t, true)
  }

  const useNow = (which: 'start' | 'end'): void => {
    const t = currentTimeOf(clip.videoId)
    if (t == null) { toast('この動画を表示中のときだけ使えます'); return }
    if (which === 'start') setStart(t, false); else setEnd(t, false)
  }
  const nudge = (which: 'start' | 'end', delta: number): void => {
    if (which === 'start') setStart(clip.start + delta)
    else setEnd((clip.end ?? dur) + delta)
  }

  const len = endOrDur - clip.start
  const startPct = toPct(clip.start)
  const endPct = toPct(endOrDur)
  const headPct = isLoaded && currentTime >= win[0] && currentTime <= win[1] ? toPct(currentTime) : null
  // 動画の範囲外（斜線）
  const voidLeftPct = win[0] < 0 ? toPct(0) : 0
  const voidRightPct = win[1] > dur ? 100 - toPct(dur) : 0
  // 目盛り
  const step = tickStep(span)
  const ticks: number[] = []
  for (let t = Math.ceil(Math.max(win[0], 0) / step) * step; t <= Math.min(win[1], dur) + 1e-6; t += step) ticks.push(r1(t))
  const zoomPct = Math.round((dur / span) * 100)

  return (
    <div ref={rootRef} className="range-editor" onClick={e => e.stopPropagation()}>
      <div className="re-head">
        <span className="re-title">{isNew ? '新しい区間' : '区間を編集'}　<b>{fmtTime(clip.start)} → {clip.end != null ? fmtTime(clip.end) : '最後'}</b>　<span className="re-len">({fmtDuration(len)})</span></span>
        <div className="re-head-btns">
          <span className="re-zoom-hint">表示 {zoomPct}%　（ホイール / ピンチ: 拡大縮小　左右スクロール / 横ドラッグ: 移動）</span>
          <button type="button" className="primary small" onClick={previewClip} title="区間の頭から再生し直す">▶ 頭から再生</button>
        </div>
      </div>

      <div className="re-track-wrap">
        <div ref={trackRef} className="re-track" onPointerDown={onTrackDown} onPointerMove={onTrackMove} onPointerUp={onTrackUp} onPointerCancel={onTrackUp}>
          {voidLeftPct > 0 && <div className="re-void re-void-left" style={{ left: 0, width: `${voidLeftPct}%` }} />}
          {voidRightPct > 0 && <div className="re-void re-void-right" style={{ right: 0, width: `${voidRightPct}%` }} />}
          {ticks.map(t => <div key={t} className="re-tick" style={{ left: `${toPctRaw(t)}%` }}><span>{fmtTime(t, false)}</span></div>)}
          <div className="re-range" style={{ left: `${startPct}%`, width: `${Math.max(endPct - startPct, 0)}%` }} />
          {headPct != null && <div className="re-head-line" style={{ left: `${headPct}%` }} />}
          <div className="re-handle re-handle-start" style={{ left: `${startPct}%` }}
            onPointerDown={onHandleDown('start')} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} title="ドラッグで開始位置を変更">
            <span className="re-handle-label">{fmtTime(clip.start)}</span>
          </div>
          <div className="re-handle re-handle-end" style={{ left: `${endPct}%` }}
            onPointerDown={onHandleDown('end')} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} title="ドラッグで終了位置を変更">
            <span className="re-handle-label">{clip.end != null ? fmtTime(clip.end) : '最後'}</span>
          </div>
        </div>
        <div className="re-scale">
          <span>{win[0] < 0 ? '' : fmtTime(win[0], false)}</span>
          <span>{known == null ? '（長さ未取得 — 一度再生すると取得します）' : `動画の長さ ${fmtTime(dur, false)}`}</span>
          <span>{win[1] > dur ? '' : fmtTime(win[1], false)}</span>
        </div>
      </div>

      <div className="re-rows">
        <div className="re-row">
          <span className="re-row-label">開始</span>
          <button type="button" onClick={() => nudge('start', -1)} title="1秒戻す">−1s</button>
          <button type="button" onClick={() => nudge('start', -0.1)} title="0.1秒戻す">−0.1</button>
          <span className="re-val">{fmtTime(clip.start)}</span>
          <button type="button" onClick={() => nudge('start', 0.1)} title="0.1秒進める">+0.1</button>
          <button type="button" onClick={() => nudge('start', 1)} title="1秒進める">+1s</button>
          <button type="button" className="re-now" onClick={() => useNow('start')} disabled={!isLoaded} title="再生中の位置を開始にする">⏺ 現在位置</button>
        </div>
        <div className="re-row">
          <span className="re-row-label">終了</span>
          <button type="button" onClick={() => nudge('end', -1)} disabled={clip.end == null} title="1秒戻す">−1s</button>
          <button type="button" onClick={() => nudge('end', -0.1)} disabled={clip.end == null} title="0.1秒戻す">−0.1</button>
          <span className="re-val">{clip.end != null ? fmtTime(clip.end) : '最後'}</span>
          <button type="button" onClick={() => nudge('end', 0.1)} disabled={clip.end == null} title="0.1秒進める">+0.1</button>
          <button type="button" onClick={() => nudge('end', 1)} disabled={clip.end == null} title="1秒進める">+1s</button>
          <button type="button" className="re-now" onClick={() => useNow('end')} disabled={!isLoaded} title="再生中の位置を終了にする">⏹ 現在位置</button>
          <label className="re-check" title="動画の最後まで再生する">
            <input type="checkbox" checked={clip.end == null} onChange={e => setEnd(e.target.checked ? null : Math.min(dur, clip.start + 10), false)} />
            最後まで
          </label>
        </div>
        <div className="re-row">
          <span className="re-row-label">メモ</span>
          <input className="re-label" value={clip.label} maxLength={60} placeholder="任意（例: サビ）"
            onChange={e => updateClip(pl.id, clip.id, { label: e.target.value })} />
          <span className="re-hint">{isPlaying ? '編集中はこの区間を繰り返し再生します。止めたい場所で「現在位置」を押すと正確に設定できます' : 'プレーヤーで止めたい場所に合わせて「現在位置」を押すと正確に設定できます'}</span>
        </div>
      </div>

      <div className="re-actions">
        {isNew && <button type="button" className="text-btn small danger" onClick={() => closeClipEditor(true)}>取り消し（この区間を削除）</button>}
        <button type="button" className="primary small" onClick={() => closeClipEditor(false)}>完了</button>
      </div>
    </div>
  )
}
