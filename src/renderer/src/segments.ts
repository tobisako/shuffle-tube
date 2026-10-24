import type { Clip, Segment } from '@shared/types'

/** 1 つのクリップに作れる区間の数 */
export const MAX_SEGMENTS = 5
/** 区間の既定の色（1 つ目から順に） */
export const DEFAULT_SEG_COLORS = ['#ff3355', '#3fa7ff', '#3ddc84', '#ffb020', '#b46cff']
/** 区間エディタで選べる色 */
export const SEG_COLOR_CHOICES = ['#ff3355', '#ff8a00', '#ffd400', '#3ddc84', '#00c8c8', '#3fa7ff', '#b46cff', '#ff5fb0']

/** クリップの全区間（1 つ目 = start〜end、2 つ目以降 = more） */
export function segmentsOf(c: Clip): Segment[] {
  return [{ start: c.start, end: c.end, color: c.color, disabled: c.disabled }, ...(c.more ?? [])]
}

/** 再生する区間（無効の区間を除く）。全部無効なら、直接再生したときのために全区間を返す */
export function playSegmentsOf(c: Clip): Segment[] {
  const segs = segmentsOf(c)
  const on = segs.filter(g => !g.disabled)
  return on.length ? on : segs
}

/** 区間が全部無効か（連続再生ではこの曲を飛ばす） */
export function allDisabled(c: Clip): boolean {
  return segmentsOf(c).every(g => g.disabled)
}

/** 最初に再生する位置 */
export function firstStart(c: Clip): number {
  return playSegmentsOf(c)[0].start
}

export function segColor(seg: Segment | undefined, i: number): string {
  return seg?.color || DEFAULT_SEG_COLORS[i % DEFAULT_SEG_COLORS.length]
}

/** 全区間を Clip の形（start / end / color + more）に戻す */
export function clipPatchFromSegments(segs: Segment[]): Partial<Clip> {
  const [first, ...rest] = segs
  return { start: first.start, end: first.end, color: first.color, disabled: first.disabled || undefined, more: rest.length ? rest : undefined }
}

/** i 番目の区間を書き換えたときの Clip の差分 */
export function patchSegment(c: Clip, i: number, patch: Partial<Segment>): Partial<Clip> {
  const segs = segmentsOf(c)
  if (!segs[i]) return {}
  segs[i] = { ...segs[i], ...patch }
  return clipPatchFromSegments(segs)
}

/** 全区間の長さの合計（null の終わりは動画の長さで数える。長さ不明なら null） */
export function totalLength(c: Clip, dur: number | null): number | null {
  let sum = 0
  for (const s of playSegmentsOf(c)) {
    const e = s.end ?? dur
    if (e == null) return null
    sum += Math.max(0, e - s.start)
  }
  return sum
}
