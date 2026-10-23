// places-search: logged-in owners only. Proxies Google Places Autocomplete (New) so the API
// key never reaches the browser. Returns place_id, name and address and nothing else.
// Nothing from Google is stored or cached.

import type { FetchLike, Rpc } from '../_shared/clients.ts'
import { bearerToken, isRecord, json, preflight, readJsonBody } from '../_shared/http.ts'

export interface PlacesSearchDeps {
  getUser: (token: string) => Promise<{ id: string } | null>
  rpc: Rpc
  googleApiKey: string | null
  fetch?: FetchLike
  /** searches allowed per account per hour (each keystroke batch counts as one) */
  perHour?: number
}

const PLACE_ID = /^[A-Za-z0-9_-]{10,200}$/
const SESSION_TOKEN = /^[A-Za-z0-9_-]{8,64}$/
const MAX_RESULTS = 5

interface Prediction {
  placeId?: unknown
  text?: { text?: unknown }
  structuredFormat?: { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } }
}

export function createPlacesSearchHandler(deps: PlacesSearchDeps) {
  const doFetch = deps.fetch ?? fetch
  const perHour = deps.perHour ?? 100

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const token = bearerToken(req)
    if (!token) return json(401, { error: 'unauthorized' })

    const parsed = await readJsonBody(req, 2_000)
    if (!parsed.ok) return parsed.response
    if (!isRecord(parsed.body)) return json(400, { error: 'invalid_request' })

    const query = typeof parsed.body.query === 'string' ? parsed.body.query.trim() : ''
    if (query.length < 3 || query.length > 100) return json(400, { error: 'invalid_query' })
    const sessionToken = parsed.body.sessionToken
    if (sessionToken !== undefined && (typeof sessionToken !== 'string' || !SESSION_TOKEN.test(sessionToken))) {
      return json(400, { error: 'invalid_session' })
    }

    if (!deps.googleApiKey) return json(500, { error: 'server_misconfigured' })

    try {
      const user = await deps.getUser(token)
      if (!user) return json(401, { error: 'unauthorized' })

      const allowed = await deps.rpc('rate_limit_hit', { p_key: `places:${user.id}`, p_limit: perHour, p_window_seconds: 3600 })
      if (allowed !== true) return json(429, { error: 'rate_limited' }, { 'Retry-After': '3600' })

      const res = await doFetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // the key travels in a header, never in a URL that could end up in logs
          'X-Goog-Api-Key': deps.googleApiKey,
          // ask Google for only what we return
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
        },
        body: JSON.stringify({ input: query, ...(sessionToken ? { sessionToken } : {}) }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) {
        console.error('places-search: Google responded with status', res.status)
        return json(502, { error: 'upstream_error' })
      }

      const data = (await res.json()) as { suggestions?: { placePrediction?: Prediction }[] }
      const results: { place_id: string; name: string; address: string }[] = []
      for (const s of data.suggestions ?? []) {
        const p = s.placePrediction
        if (!p || typeof p.placeId !== 'string' || !PLACE_ID.test(p.placeId)) continue
        const name = p.structuredFormat?.mainText?.text ?? p.text?.text
        const address = p.structuredFormat?.secondaryText?.text
        if (typeof name !== 'string') continue
        results.push({ place_id: p.placeId, name, address: typeof address === 'string' ? address : '' })
        if (results.length === MAX_RESULTS) break
      }
      return json(200, { results })
    } catch (err) {
      console.error('places-search failed:', err instanceof Error ? err.name : 'unknown error')
      return json(502, { error: 'upstream_error' })
    }
  }
}
