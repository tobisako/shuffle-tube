/** 秒 → "m:ss" / "h:mm:ss"（0.1 秒単位の端数があれば ".d" を付ける） */
export function fmtTime(sec: number | null | undefined, showTenths = true): string {
  if (sec == null || !Number.isFinite(sec)) return '--:--'
  const tenths = Math.max(0, Math.round(sec * 10))
  const total = Math.floor(tenths / 10)
  const frac = tenths % 10
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  let out = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
  if (frac && showTenths) out += `.${frac}`
  return out
}

/** 長さ表示: "10秒" / "1分30秒" */
export function fmtDuration(sec: number): string {
  const t = Math.round(sec * 10) / 10
  if (t < 60) return `${t}秒`
  const m = Math.floor(t / 60)
  const s = Math.round((t - m * 60) * 10) / 10
  return s ? `${m}分${s}秒` : `${m}分`
}

/**
 * "39" / "39.5" / "0:39" / "1:02:03" / "1:02:03.5" → 秒
 * 空文字 → null、解釈不能 → NaN
 */
export function parseTime(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const m = s.match(/^(?:(\d+):(?:(\d{1,2}):)?)?(\d+(?:\.\d+)?)$/)
  if (!m) return NaN
  const [, a, b, c] = m
  const sec = parseFloat(c)
  if (a === undefined) return sec
  if (b === undefined) return parseInt(a, 10) * 60 + sec
  return parseInt(a, 10) * 3600 + parseInt(b, 10) * 60 + sec
}

/** 終了欄: "+10" なら 開始 + 10 秒 */
export function parseEnd(input: string, start: number): number | null {
  const s = input.trim()
  if (!s) return null
  if (s.startsWith('+')) {
    const d = parseTime(s.slice(1))
    if (d == null || Number.isNaN(d)) return NaN
    return start + d
  }
  return parseTime(s)
}

/** YouTube URL の t= (例: 1m30s, 90s, 90) → 秒 */
export function parseYouTubeT(v: string | null): number | null {
  if (!v) return null
  if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v)
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseFloat(m[3] || '0')
}

export const round1 = (n: number): number => Math.round(n * 10) / 10
