import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Clip, Playlist, Segment } from '@shared/types'
import { getPlayingClip, toast, toggleSegmentDisabled, updateClip, useStore } from '../store'
import { closeClipEditor, currentTimeOf, previewClip, seekPreview, selectSegment, setScrubbing } from '../player'
import { MAX_SEGMENTS, SEG_COLOR_CHOICES, clipPatchFromSegments, patchSegment, segColor, segmentLanes, segmentsOf, totalLength } from '../segments'
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
 *  - トラック上でホイール: カーソル位置を中心に連続的に拡大縮小。左右スクロール・横ドラッグ（マウス / 指）で表示範囲を移動
 *  - 動画の範囲外（0:00 より前 / 最後より後）は斜線の背景で描く
 *  - 「現在位置」ボタン、±1秒 / ±0.1秒 ボタン、「最後まで」スイッチ
 *  - 1 曲に区間を最大 5 つまで作れる（タイムラインの右クリック →「区間を追加」でカーソルの位置に作る）。
 *    編集するのは選んでいる区間で、区間ごとに色を変えられる
 *  - 「キャンセル」で開いた時点の状態に戻して閉じる
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

  const segs = segmentsOf(clip)
  const selIdx = useStore(s => (s.editing?.clipId === clip.id ? Math.min(s.editing.seg, segs.length - 1) : 0))
  const sel = segs[selIdx]
  const known = clip.duration ?? (isLoaded && loadedDuration > 0 ? loadedDuration : null)
  // 長さが未取得のときの全体幅。ドラッグでスケールが変わらないよう最初に一度だけ決める
  const [fallbackDur] = useState(() => Math.max(...segmentsOf(clip).map(g => (g.end ?? g.start) + 30), 60))
  const dur = known ?? fallbackDur
  const endOrDur = sel.end ?? dur

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

  // マウス・タッチ: 横ドラッグで表示範囲を移動、2 本指ピンチで拡大縮小、動かさずに離せばシーク
  const pointers = useRef(new Map<number, number>())
  const [panning, setPanning] = useState(false)
  const gesture = useRef<{ mode: 'tap' | 'pan' | 'pinch'; startX: number; startWin: [number, number]; startDist: number; startSpan: number; midFrac: number } | null>(null)
  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
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
    if (g.mode === 'tap' && Math.abs(dx) > (e.pointerType === 'mouse' ? 4 : 8)) { g.mode = 'pan'; setPanning(true) }
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
    if (pointers.current.size === 0) { gesture.current = null; setPanning(false) }
    else if (pointers.current.size === 1 && g) { g.mode = 'pan'; g.startX = [...pointers.current.values()][0]; g.startWin = winRef.current }
  }

  // 区間の書き換えは、ドラッグ中の古い描画の値ではなく最新のクリップに当てる
  const latestClip = (): Clip => useStore.getState().playlists.find(p => p.id === pl.id)?.items.find(c => c.id === clip.id) ?? clip
  const updateSel = (patch: Partial<Segment>): void => updateClip(pl.id, clip.id, patchSegment(latestClip(), selIdx, patch))
  const setStart = (t: number, seek = true, final = true): void => {
    const v = r1(clamp(t, 0, endOrDur - MIN_GAP))
    if (v !== sel.start) updateSel({ start: v })
    if (seek && isLoaded) throttledSeek(v, final)
  }
  const setEnd = (t: number | null, seek = true, final = true): void => {
    if (t == null) { updateSel({ end: null }); return }
    const v = r1(clamp(t, sel.start + MIN_GAP, dur))
    if (v !== sel.end) updateSel({ end: v })
    if (seek && isLoaded) throttledSeek(v, final)
  }

  /** t 秒の位置から 10 秒の区間を足す（動画の最後に近ければ最後までに収める） */
  const addSegmentAt = (t: number): void => {
    if (segs.length >= MAX_SEGMENTS) return
    const start = r1(clamp(t, 0, Math.max(0, dur - 1)))
    const seg: Segment = { start, end: r1(Math.min(dur, start + 10)) }
    updateClip(pl.id, clip.id, clipPatchFromSegments([...segmentsOf(latestClip()), seg]))
    selectSegment(segs.length)
  }
  const removeSegmentAt = (idx: number): void => {
    if (segs.length <= 1) return
    const next = segmentsOf(latestClip()).filter((_, i) => i !== idx)
    updateClip(pl.id, clip.id, clipPatchFromSegments(next))
    selectSegment(Math.max(0, Math.min(idx === selIdx ? selIdx - 1 : selIdx > idx ? selIdx - 1 : selIdx, next.length - 1)))
  }

  // 区間ボタンのドラッグで、再生の順番を入れ替える
  const segDrag = useRef<number | null>(null)
  const [segDrop, setSegDrop] = useState<{ i: number; before: boolean } | null>(null)
  const moveSegment = (from: number, target: number, before: boolean): void => {
    let to = before ? target : target + 1
    if (from < to) to--
    if (from === to) return
    // 色を決めていない区間は番号で色が決まるので、入れ替えても色が変わらないよう今の色を書き込む
    const cur = segmentsOf(latestClip()).map((g, i) => ({ ...g, color: segColor(g, i) }))
    const [m] = cur.splice(from, 1)
    cur.splice(to, 0, m)
    updateClip(pl.id, clip.id, clipPatchFromSegments(cur))
    // 選んでいた区間を選んだままにする（再生位置は動かさない）
    const newSel = selIdx === from ? to : selIdx > from && selIdx <= to ? selIdx - 1 : selIdx < from && selIdx >= to ? selIdx + 1 : selIdx
    const ed = useStore.getState().editing
    if (ed) useStore.setState({ editing: { ...ed, seg: newSel } })
  }

  // タイムラインの右クリックメニュー（x, y はトラック枠からの位置、t はその位置の時刻、hit はその位置の区間）
  const wrapRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; t: number; hit: number } | null>(null)
  const onTrackContextMenu = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const wr = wrapRef.current!.getBoundingClientRect()
    const r = trackRef.current!.getBoundingClientRect()
    const t = win[0] + ((e.clientX - r.left) / r.width) * span
    // 区間は最低 6px の幅で描くので、その幅ぶんは区間の上として扱う。重なっていれば選んでいる区間を優先
    const minSec = (6 / r.width) * span
    const on = (g: Segment): boolean => t >= g.start && t <= Math.max(g.end ?? dur, g.start + minSec)
    const hit = on(sel) ? selIdx : segs.findIndex(on)
    // 右端で切れないよう、メニューの幅（約 220px）ぶん左に寄せる
    setMenu({ x: Math.max(0, Math.min(e.clientX - wr.left, wr.width - 220)), y: e.clientY - wr.top, t, hit })
  }
  useEffect(() => {
    if (!menu) return
    const close = (ev: Event): void => {
      if (ev instanceof KeyboardEvent) {
        if (ev.key !== 'Escape') return
        // メニューを閉じるだけにする（エディタ全体を閉じる Escape の処理まで届かせない）
        ev.stopPropagation()
        ev.preventDefault()
      }
      if (ev.type === 'pointerdown' && (ev.target as Element | null)?.closest?.('.re-menu')) return
      setMenu(null)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', close, true)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', close, true)
      window.removeEventListener('blur', close)
    }
  }, [menu])
  const throttledSeek = (t: number, final: boolean): void => {
    // 再生中は止めずに流し続ける（範囲だけ変わり、次の周回から反映）。止まっているときはそのフレームを表示
    if (useStore.getState().isPlaying) return
    const now = Date.now()
    if (!final && now - lastSeek.current < 80) return
    lastSeek.current = now
    seekPreview(t, final)
  }

  const onHandleDown = (which: 'start' | 'end') => (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
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
    const t = r1(fromClientX(e.clientX))
    // 選んでいない区間の上をクリックしたら、その区間を選ぶ
    if (!(t >= sel.start && t <= endOrDur)) {
      const hit = segs.findIndex((g, i) => i !== selIdx && t >= g.start && t <= (g.end ?? dur))
      if (hit >= 0) { selectSegment(hit); return }
    }
    if (!isLoaded) return
    // 選んでいる区間の外や動画の範囲外をクリックしたら、その区間の開始バーの位置から
    const outside = t < sel.start || (sel.end != null && t > sel.end) || t < 0 || t > dur
    seekPreview(outside ? sel.start : t, true)
  }

  const useNow = (which: 'start' | 'end'): void => {
    const t = currentTimeOf(clip.videoId)
    if (t == null) { toast('この動画を表示中のときだけ使えます'); return }
    if (which === 'start') setStart(t, false); else setEnd(t, false)
  }
  const nudge = (which: 'start' | 'end', delta: number): void => {
    if (which === 'start') setStart(sel.start + delta)
    else setEnd((sel.end ?? dur) + delta)
  }

  const len = endOrDur - sel.start
  const total = totalLength(clip, dur)
  const selColor = segColor(sel, selIdx)
  // 区間が重なるときは上下の段に分けて描く
  const lanes = segmentLanes(segs, dur)
  const laneStyle = (i: number): CSSProperties => (lanes.count > 1
    ? { top: `${(lanes.lane[i] * 100) / lanes.count}%`, bottom: 'auto', height: `calc(${100 / lanes.count}% - 2px)` }
    : {})
  const startPct = toPct(sel.start)
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
  // 拡大スライダー（0 = 動画全体、100 = 最大の拡大）。対数で動かし、選んでいる区間を中心に拡大縮小する
  const zoomRange = Math.log(Math.max(dur / MIN_SPAN, 1.0001))
  const zoomVal = Math.round(clamp(Math.log(Math.max(dur / span, 1)) / zoomRange, 0, 1) * 100)
  const selMid = sel.start + (endOrDur - sel.start) / 2
  const setZoom = (v: number): void => {
    if (v <= 0) { setWin([0, dur]); return }
    const ns = dur / Math.exp((v / 100) * zoomRange)
    setWin(bounded(selMid - ns / 2, selMid + ns / 2, dur))
  }
  /** 選んでいる区間が表示幅の 6 割ほどになるように合わせる */
  const fitSelected = (): void => {
    const ns = clamp((endOrDur - sel.start) / 0.6, MIN_SPAN, dur)
    setWin(bounded(selMid - ns / 2, selMid + ns / 2, dur))
  }

  return (
    <div ref={rootRef} className="range-editor" onClick={e => e.stopPropagation()}>
      <div className="re-head">
        <span className="re-title">{isNew ? '新しい区間' : '区間を編集'}{segs.length > 1 ? ` ${selIdx + 1}` : ''}　<b>{fmtTime(sel.start)} → {sel.end != null ? fmtTime(sel.end) : '最後'}</b>　<span className="re-len">({fmtDuration(len)}{segs.length > 1 && total != null ? `／全 ${segs.length} 区間 ${fmtDuration(total)}` : ''})</span></span>
        <div className="re-head-btns">
          <span className="re-zoom-hint">表示 {zoomPct}%　（スライダー / ホイール / ピンチ: 拡大縮小　横ドラッグ / 左右スクロール: 移動）</span>
          <button type="button" className="primary small" onClick={previewClip} title="区間の頭から再生し直す">▶ 頭から再生</button>
        </div>
      </div>

      <div className="re-segs">
        {segs.map((g, i) => (
          <button key={i} type="button" style={{ '--seg': segColor(g, i) } as CSSProperties}
            className={'re-seg' + (i === selIdx ? ' on' : '') + (g.disabled ? ' off' : '') + (segDrop?.i === i ? (segDrop.before ? ' drop-before' : ' drop-after') : '')}
            onClick={() => selectSegment(i)} title={`区間 ${i + 1} を編集（ドラッグで再生の順番を入れ替え・右クリックで有効 / 無効・削除）`}
            onContextMenu={e => {
              e.preventDefault()
              const wr = wrapRef.current!.getBoundingClientRect()
              setMenu({ x: Math.max(0, Math.min(e.clientX - wr.left, wr.width - 220)), y: e.clientY - wr.top, t: g.start, hit: i })
            }}
            draggable={segs.length > 1}
            onDragStart={e => { segDrag.current = i; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', `区間 ${i + 1}`) } catch { /* ignore */ } }}
            onDragEnd={() => { segDrag.current = null; setSegDrop(null) }}
            onDragOver={e => {
              if (segDrag.current == null) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const r = e.currentTarget.getBoundingClientRect()
              const before = e.clientX - r.left < r.width / 2
              if (segDrop?.i !== i || segDrop.before !== before) setSegDrop({ i, before })
            }}
            onDrop={e => {
              e.preventDefault()
              const from = segDrag.current
              segDrag.current = null
              setSegDrop(null)
              if (from == null) return
              const r = e.currentTarget.getBoundingClientRect()
              moveSegment(from, i, e.clientX - r.left < r.width / 2)
            }}>
            <span className="re-seg-dot" />区間 {i + 1}<span className="re-seg-time">{fmtTime(g.start, false)}</span>
          </button>
        ))}
        <span className="re-seg-hint">右クリック（スマホは長押し）で区間の追加・有効 / 無効・削除。ボタンをドラッグで順番を入れ替え（最大 {MAX_SEGMENTS} つ。左から順に再生、無効は飛ばす）</span>
        <span className="re-colors" title="選んでいる区間の色">
          {SEG_COLOR_CHOICES.map(c => (
            <button key={c} type="button" className={'re-color' + (c === selColor ? ' on' : '')} style={{ background: c }}
              onClick={() => updateSel({ color: c })} aria-label={`色 ${c}`} />
          ))}
        </span>
      </div>

      <div ref={wrapRef} className="re-track-wrap">
        <div ref={trackRef} className={'re-track' + (panning ? ' panning' : '')} style={lanes.count >= 3 ? { height: lanes.count * 16 } : undefined} onContextMenu={onTrackContextMenu} onPointerDown={onTrackDown} onPointerMove={onTrackMove} onPointerUp={onTrackUp} onPointerCancel={onTrackUp}>
          {voidLeftPct > 0 && <div className="re-void re-void-left" style={{ left: 0, width: `${voidLeftPct}%` }} />}
          {voidRightPct > 0 && <div className="re-void re-void-right" style={{ right: 0, width: `${voidRightPct}%` }} />}
          {ticks.map(t => <div key={t} className="re-tick" style={{ left: `${toPctRaw(t)}%` }}><span>{fmtTime(t, false)}</span></div>)}
          {segs.map((g, i) => i === selIdx ? null : (
            <div key={i} className={'re-range re-range-other' + (g.disabled ? ' off' : '')}
              style={{ left: `${toPct(g.start)}%`, width: `${Math.max(toPct(g.end ?? dur) - toPct(g.start), 0)}%`, '--seg': segColor(g, i), ...laneStyle(i) } as CSSProperties} />
          ))}
          <div className={'re-range' + (sel.disabled ? ' off' : '')} style={{ left: `${startPct}%`, width: `${Math.max(endPct - startPct, 0)}%`, '--seg': selColor, ...laneStyle(selIdx) } as CSSProperties} />
          {headPct != null && <div className="re-head-line" style={{ left: `${headPct}%` }} />}
          <div className="re-handle re-handle-start" style={{ left: `${startPct}%`, '--seg': selColor } as CSSProperties}
            onPointerDown={onHandleDown('start')} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} title="ドラッグで開始位置を変更">
            <span className="re-handle-label">{fmtTime(sel.start)}</span>
          </div>
          <div className="re-handle re-handle-end" style={{ left: `${endPct}%`, '--seg': selColor } as CSSProperties}
            onPointerDown={onHandleDown('end')} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} title="ドラッグで終了位置を変更">
            <span className="re-handle-label">{sel.end != null ? fmtTime(sel.end) : '最後'}</span>
          </div>
        </div>
        {menu && (
          <div className="re-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()}>
            {menu.hit >= 0 && (
              <button type="button" onClick={() => { toggleSegmentDisabled(pl.id, clip.id, menu.hit); setMenu(null) }}>
                {segs[menu.hit]?.disabled ? `有効にする（区間 ${menu.hit + 1} を再生する）` : `無効にする（区間 ${menu.hit + 1} を一時的に再生しない）`}
              </button>
            )}
            {menu.hit >= 0 ? (
              <button type="button" className="danger" disabled={segs.length <= 1}
                onClick={() => { removeSegmentAt(menu.hit); setMenu(null) }}>
                この区間を削除（区間 {menu.hit + 1}）{segs.length <= 1 ? ' — 最後の 1 つは消せません' : ''}
              </button>
            ) : (
              <button type="button" disabled={segs.length >= MAX_SEGMENTS}
                onClick={() => { addSegmentAt(menu.t); setMenu(null) }}>
                区間を追加（{fmtTime(clamp(menu.t, 0, dur), false)} から）{segs.length >= MAX_SEGMENTS ? ` — 最大 ${MAX_SEGMENTS} つ` : ''}
              </button>
            )}
            <button type="button" onClick={() => setMenu(null)}>キャンセル</button>
          </div>
        )}
        <div className="re-zoom">
          <span className="re-zoom-label">縮小</span>
          <input type="range" min={0} max={100} step={1} value={zoomVal} onChange={e => setZoom(Number(e.target.value))}
            aria-label="タイムラインの拡大縮小" title="スライドで拡大縮小（選んでいる区間を中心に）" />
          <span className="re-zoom-label">拡大</span>
          <button type="button" className="text-btn small" onClick={fitSelected} title="選んでいる区間が見やすい大きさにする">区間に合わせる</button>
          <button type="button" className="text-btn small" onClick={() => setWin([0, dur])} title="動画全体を表示する">全体</button>
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
          <span className="re-val">{fmtTime(sel.start)}</span>
          <button type="button" onClick={() => nudge('start', 0.1)} title="0.1秒進める">+0.1</button>
          <button type="button" onClick={() => nudge('start', 1)} title="1秒進める">+1s</button>
          <button type="button" className="re-now" onClick={() => useNow('start')} disabled={!isLoaded} title="再生中の位置を開始にする">⏺ 現在位置</button>
        </div>
        <div className="re-row">
          <span className="re-row-label">終了</span>
          <button type="button" onClick={() => nudge('end', -1)} disabled={sel.end == null} title="1秒戻す">−1s</button>
          <button type="button" onClick={() => nudge('end', -0.1)} disabled={sel.end == null} title="0.1秒戻す">−0.1</button>
          <span className="re-val">{sel.end != null ? fmtTime(sel.end) : '最後'}</span>
          <button type="button" onClick={() => nudge('end', 0.1)} disabled={sel.end == null} title="0.1秒進める">+0.1</button>
          <button type="button" onClick={() => nudge('end', 1)} disabled={sel.end == null} title="1秒進める">+1s</button>
          <button type="button" className="re-now" onClick={() => useNow('end')} disabled={!isLoaded} title="再生中の位置を終了にする">⏹ 現在位置</button>
          <label className="re-check" title="動画の最後まで再生する">
            <input type="checkbox" checked={sel.end == null} onChange={e => setEnd(e.target.checked ? null : Math.min(dur, sel.start + 10), false)} />
            最後まで
          </label>
        </div>
        <div className="re-row">
          <span className="re-row-label">メモ</span>
          <input className="re-label" value={clip.label} maxLength={200} placeholder="任意（例: サビ、練習ポイント）"
            onChange={e => updateClip(pl.id, clip.id, { label: e.target.value })} />
          <span className="re-hint">{isPlaying ? '編集中はこの区間を繰り返し再生します。止めたい場所で「現在位置」を押すと正確に設定できます' : 'プレーヤーで止めたい場所に合わせて「現在位置」を押すと正確に設定できます'}</span>
        </div>
      </div>

      <div className="re-actions">
        <button type="button" className="text-btn small" onClick={() => closeClipEditor(true)}
          title={isNew ? 'この新しい区間を削除して閉じる' : '開いた時点の区間・色・メモに戻して閉じる'}>キャンセル</button>
        <button type="button" className="primary small" onClick={() => closeClipEditor(false)} title="変更を残したまま閉じる（変更はすでに保存されています）">完了</button>
      </div>
    </div>
  )
}
