import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { useStore } from '../store'

export default function Toast(): JSX.Element | null {
  const t = useStore(s => s.toast)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!t) return
    setVisible(true)
    const id = window.setTimeout(() => setVisible(false), 2600)
    return () => window.clearTimeout(id)
  }, [t])
  if (!t || !visible) return null
  return <div className="toast">{t.msg}</div>
}
