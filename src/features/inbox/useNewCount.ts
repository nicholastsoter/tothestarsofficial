import { useEffect, useState } from 'react'
import { CHANGED_EVENT, fetchNewCount } from './api'

/** The number of unread ("new") feedback items, refreshed every minute and after any change. */
export function useNewCount(enabled: boolean): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const refresh = () => void fetchNewCount().then((n) => alive && setCount(n))
    refresh()
    const timer = setInterval(refresh, 60_000)
    window.addEventListener(CHANGED_EVENT, refresh)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener(CHANGED_EVENT, refresh)
    }
  }, [enabled])
  return count
}
