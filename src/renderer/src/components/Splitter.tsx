import type { JSX } from 'react'
import { useRef } from 'react'
import { updateSettings, useStore } from '../store'

const MIN_PLAYER = 120
const MIN_LIST = 100

/** プレーヤーと一覧の境界。上下にドラッグしてプレーヤーの高さを変える（ダブルクリックで自動に戻す） */
export default function Splitter(): JSX.Element {
  const drag = useRef<{ y: number; h: number; max: number } | null>(null)
  const setHeight = (h: number): void => {
    const s = useStore.getState()
    useStore.setState({ settings: { ...s.settings, playerHeight: h } })
  }
  return (
    <div className="splitter" title="ドラッグで動画と一覧の大きさを変更（ダブルクリックで元に戻す）"
      onPointerDown={e => {
        const wrap = document.querySelector<HTMLElement>('.main .player-wrap')
        const list = document.querySelector<HTMLElement>('.main .items')
        if (!wrap) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const h = wrap.getBoundingClientRect().height
        drag.current = { y: e.clientY, h, max: h + Math.max(0, (list?.getBoundingClientRect().height ?? 0) - MIN_LIST) }
        document.body.classList.add('resizing')
      }}
      onPointerMove={e => {
        const d = drag.current
        if (!d) return
        setHeight(Math.round(Math.min(d.max, Math.max(MIN_PLAYER, d.h + e.clientY - d.y))))
      }}
      onPointerUp={e => {
        if (!drag.current) return
        drag.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.classList.remove('resizing')
        window.api.saveSettings({ playerHeight: useStore.getState().settings.playerHeight })
      }}
      onDoubleClick={() => updateSettings({ playerHeight: null })}
    >
      <span className="splitter-grip" />
    </div>
  )
}
