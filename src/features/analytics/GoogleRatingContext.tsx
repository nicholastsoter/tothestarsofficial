// Holds the live Google rating in React state ONLY, for as long as the page stays open. It is never
// written to localStorage, sessionStorage, IndexedDB, cookies or any database: a reload starts empty
// and fetches again. The value comes from the google-rating Edge Function, which looks up the listing
// of the logged-in user's own business.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { asErrorCode, type GoogleErrorCode } from './googleFormat'

interface GoogleRatingState {
  status: 'idle' | 'loading' | 'ready'
  rating: number | null
  reviewCount: number
  /** when the value was fetched (milliseconds), or null if there is no value yet */
  fetchedAt: number | null
  /** the last problem, if any; a value from an earlier successful fetch stays visible beside it */
  error: GoogleErrorCode | null
}

interface GoogleRatingApi extends GoogleRatingState {
  /** fetches once per page load; later calls do nothing */
  ensureLoaded: () => void
  /** the manual refresh button */
  refresh: () => Promise<void>
}

const GoogleRatingContext = createContext<GoogleRatingApi | null>(null)

export function GoogleRatingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GoogleRatingState>({ status: 'idle', rating: null, reviewCount: 0, fetchedAt: null, error: null })
  const started = useRef(false)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    started.current = true
    setState((s) => ({ ...s, status: 'loading', error: null }))
    try {
      const { data, error } = await supabase.functions.invoke('google-rating')
      if (error) {
        let code: GoogleErrorCode = 'unknown'
        if (error instanceof FunctionsHttpError) code = asErrorCode(await error.context.json().then((b: { error?: string }) => b.error).catch(() => undefined))
        setState((s) => ({ ...s, status: 'ready', error: code }))
        return
      }
      const d = data as { rating: number | null; review_count: number }
      setState({ status: 'ready', rating: d.rating, reviewCount: d.review_count, fetchedAt: Date.now(), error: null })
    } catch {
      setState((s) => ({ ...s, status: 'ready', error: 'unknown' }))
    } finally {
      inFlight.current = false
    }
  }, [])

  const ensureLoaded = useCallback(() => {
    if (started.current) return
    started.current = true
    void refresh()
  }, [refresh])

  const value = useMemo(() => ({ ...state, ensureLoaded, refresh }), [state, ensureLoaded, refresh])
  return <GoogleRatingContext.Provider value={value}>{children}</GoogleRatingContext.Provider>
}

export function useGoogleRating(): GoogleRatingApi {
  const ctx = useContext(GoogleRatingContext)
  if (!ctx) throw new Error('useGoogleRating must be used inside <GoogleRatingProvider>')
  return ctx
}
