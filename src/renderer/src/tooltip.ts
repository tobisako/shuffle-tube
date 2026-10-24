/**
 * マウスを乗せたときの説明の吹き出し。title 属性を持つ要素すべてが対象。
 * OS 標準の表示は出るまで 1 秒ほどかかり、Mac のアプリではウィンドウが前面にないと出ないことがあるため、自前で出す。
 * title は data-tip に移して、OS 標準の表示と二重に出ないようにする。指の操作（スマホ）では出さない。
 */
const DELAY_MS = 350

let tip: HTMLDivElement | null = null
let timer: number | null = null
let target: Element | null = null

function hide(): void {
  if (timer) { window.clearTimeout(timer); timer = null }
  target = null
  if (tip) tip.style.display = 'none'
}

function show(el: Element): void {
  const text = el.getAttribute('data-tip')
  if (!text) return
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'tooltip'
    tip.setAttribute('role', 'tooltip')
    document.body.appendChild(tip)
  }
  tip.textContent = text
  tip.style.display = 'block'
  // 要素の下に出す。下に入らなければ上、左右は画面からはみ出さないように寄せる
  const r = el.getBoundingClientRect()
  const tw = tip.offsetWidth
  const th = tip.offsetHeight
  let x = r.left + r.width / 2 - tw / 2
  x = Math.max(6, Math.min(x, window.innerWidth - tw - 6))
  let y = r.bottom + 6
  if (y + th > window.innerHeight - 4) y = r.top - th - 6
  tip.style.left = `${Math.round(x)}px`
  tip.style.top = `${Math.round(Math.max(4, y))}px`
}

export function initTooltips(): void {
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return
    const el = (e.target as Element | null)?.closest?.('[title], [data-tip]')
    if (!el || el === target) return
    // React が title を付け直していたら（文言が変わったとき）、そちらを使う
    const t = el.getAttribute('title')
    if (t) { el.setAttribute('data-tip', t); el.removeAttribute('title') }
    hide()
    target = el
    timer = window.setTimeout(() => { if (target === el && el.isConnected) show(el) }, DELAY_MS)
  })
  document.addEventListener('pointerout', e => {
    if (!target) return
    const to = e.relatedTarget as Node | null
    if (to && target.contains(to)) return
    hide()
  })
  for (const type of ['pointerdown', 'keydown', 'wheel', 'blur']) window.addEventListener(type, hide, true)
  window.addEventListener('scroll', hide, true)
}
