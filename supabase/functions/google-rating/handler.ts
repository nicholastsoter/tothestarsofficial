// google-rating: the live "your Google rating" panel. Fetches the CURRENT star rating and review count
// from Google every time and returns just those two values. Nothing from Google is stored, cached or
// logged. The Place ID is read from the database for the CALLER'S OWN business: whatever the request
// says (body, query string, headers) is ignored, so nobody can look up someone else's listing.

import type { FetchLike, Rpc } from '../_shared/clients.ts'
import { bearerToken, json, preflight } from '../_shared/http.ts'
import { GOOGLE_RATING_GLOBAL_PER_DAY, GOOGLE_RATING_PER_BUSINESS_PER_DAY } from '../_shared/limits.ts'

export interface GoogleRatingDeps {
  getUser: (token: string) => Promise<{ id: string } | null>
  findOwnBusiness: (userId: string) => Promise<{ id: string; place_id: string | null } | null>
  rpc: Rpc
  googleApiKey: string | null
  fetch?: FetchLike
  /** overridable for tests; the shipped numbers live in _shared/limits.ts */
  perBusinessPerDay?: number
  globalPerDay?: number
}

const PLACE_ID = /^[A-Za-z0-9_-]{10,200}$/
const DAY = 86_400

export function createGoogleRatingHandler(deps: GoogleRatingDeps) {
  const doFetch = deps.fetch ?? fetch
  const perBusiness = deps.perBusinessPerDay ?? GOOGLE_RATING_PER_BUSINESS_PER_DAY
  const globalCap = deps.globalPerDay ?? GOOGLE_RATING_GLOBAL_PER_DAY
  const noStore = { 'Cache-Control': 'no-store' }
  const reply = (status: number, body: unknown, extra: Record<string, string> = {}) => json(status, body, { ...noStore, ...extra })

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

    const token = bearerToken(req)
    if (!token) return reply(401, { error: 'unauthorized' })
    // The request body is deliberately never read.

    try {
      const user = await deps.getUser(token)
      if (!user) return reply(401, { error: 'unauthorized' })
      if (!deps.googleApiKey) return reply(500, { error: 'server_misconfigured' })

      // problems with setup are reported BEFORE any counter is touched, so they never use up an allowance
      const business = await deps.findOwnBusiness(user.id)
      if (!business) return reply(404, { error: 'no_business' })
      if (!business.place_id || !PLACE_ID.test(business.place_id)) return reply(404, { error: 'no_listing' })

      // The business's own allowance first, then the shared one. A business that has used up its day is
      // stopped here and never reaches (or spends) the global allowance. Both counters are UTC days, so
      // they reset together, which means a business turned away by the global cap loses nothing real.
      const bizOk = await deps.rpc('rate_limit_hit', { p_key: `gratings:biz:${business.id}`, p_limit: perBusiness, p_window_seconds: DAY })
      if (bizOk !== true) return reply(429, { error: 'business_cap' }, { 'Retry-After': String(DAY) })
      const globalOk = await deps.rpc('rate_limit_hit', { p_key: 'gratings:global', p_limit: globalCap, p_window_seconds: DAY })
      if (globalOk !== true) return reply(429, { error: 'google_busy' }, { 'Retry-After': String(DAY) })

      const res = await doFetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(business.place_id)}`, {
        method: 'GET',
        headers: {
          // the key travels in a header, never in a URL that could end up in logs
          'X-Goog-Api-Key': deps.googleApiKey,
          // ONLY these two fields. They are billed as Place Details Enterprise.
          'X-Goog-FieldMask': 'rating,userRatingCount',
        },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 404) return reply(404, { error: 'listing_not_found' })
      if (!res.ok) {
        console.error('google-rating: Google responded with status', res.status) // the status only, never the body
        return reply(502, { error: 'google_unavailable' })
      }

      const data = (await res.json()) as { rating?: unknown; userRatingCount?: unknown }
      const rating = typeof data.rating === 'number' && Number.isFinite(data.rating) && data.rating >= 0 && data.rating <= 5 ? Math.round(data.rating * 10) / 10 : null
      const count = typeof data.userRatingCount === 'number' && Number.isInteger(data.userRatingCount) && data.userRatingCount >= 0 ? data.userRatingCount : 0
      // exactly two values go back: nothing else Google sent, not even the Place ID
      return reply(200, { rating, review_count: count })
    } catch (err) {
      console.error('google-rating failed:', err instanceof Error ? err.name : 'unknown error')
      return reply(502, { error: 'google_unavailable' })
    }
  }
}
