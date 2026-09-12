import { useEffect, useState } from 'react'

const QUERY = '(max-width: 760px)'

/** 幅の狭い画面（スマホ）か */
export function useIsMobile(): boolean {
  const [m, setM] = useState(() => window.matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = (): void => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}
