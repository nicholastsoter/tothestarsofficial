import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { GOOGLE_RATING_GLOBAL_PER_DAY, GOOGLE_RATING_PER_BUSINESS_PER_DAY } from '../functions/_shared/limits'
import { createGoogleRatingHandler, type GoogleRatingDeps } from '../functions/google-rating/handler'
import { createDb, createTenant, dbContains, pgRpc, type Tenant } from './helpers'

const KEY = 'AIzaSy-SECRET-GOOGLE-KEY-123456'
const PLACE_A = 'ChIJ-place-id-for-business-A-xxx'
const PLACE_B = 'ChIJ-place-id-for-business-B-yyy'
// distinctive numbers so any leak into a log, table or response is easy to spot
const RATING = 4.37
const COUNT = 1234

let db: PGlite
let a: Tenant
let b: Tenant
let c: Tenant // has a business but no Google listing connected
const tokens: Record<string, string> = {}

/** What Google would return: our two fields plus plenty we must never pass on. */
const googleOk = () =>
  new Response(
    JSON.stringify({
      rating: RATING,
      userRatingCount: COUNT,
      displayName: { text: 'Secret Display Name' },
      formattedAddress: '1 Secret St',
      reviews: [{ text: { text: 'a private review text' } }],
      nationalPhoneNumber: '555-0100',
      id: PLACE_A,
    }),
    { status: 200 },
  )

function setup(over: Partial<GoogleRatingDeps> = {}, fetchImpl?: typeof fetch) {
  const fetchSpy = vi.fn(fetchImpl ?? (async () => googleOk()))
  const deps: GoogleRatingDeps = {
    getUser: async (t) => (tokens[t] ? { id: tokens[t] } : null),
    findOwnBusiness: async (userId) => {
      const r = await db.query<{ id: string; place_id: string | null }>(`select id, place_id from public.businesses where owner_user_id = $1`, [userId])
      return r.rows[0] ?? null
    },
    rpc: pgRpc(db),
    googleApiKey: KEY,
    fetch: fetchSpy as unknown as typeof fetch,
    ...over,
  }
  const handler = createGoogleRatingHandler(deps)
  const call = async (token: string | null = 'ta', init: { method?: string; body?: unknown; query?: string; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? 'POST'
    const res = await handler(
      new Request(`https://example.test/functions/v1/google-rating${init.query ?? ''}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
        body: method === 'POST' && init.body !== undefined ? JSON.stringify(init.body) : undefined,
      }),
    )
    const text = await res.text()
    return { status: res.status, text, json: text ? JSON.parse(text) : null, headers: res.headers }
  }
  return { call, fetchSpy }
}

const counter = async (key: string) =>
  Number((await db.query<{ n: number }>(`select coalesce(sum(count), 0)::int as n from public.rate_limits where key = $1`, [key])).rows[0].n)
const resetCounters = () => db.query(`delete from public.rate_limits`)

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
  c = await createTenant(db, 'Charlie Cuts', 'charlie-cuts')
  await db.query(`update public.businesses set place_id = $2 where id = $1`, [a.businessId, PLACE_A])
  await db.query(`update public.businesses set place_id = $2 where id = $1`, [b.businessId, PLACE_B])
  Object.assign(tokens, { ta: a.userId, tb: b.userId, tc: c.userId })
})

describe('shipped caps', () => {
  it('are 5 per business per day and 30 per day overall, defined in one place', () => {
    expect(GOOGLE_RATING_PER_BUSINESS_PER_DAY).toBe(5)
    expect(GOOGLE_RATING_GLOBAL_PER_DAY).toBe(30)
  })
})

describe('authentication', () => {
  it('rejects a missing or forged token and never calls Google or touches a counter', async () => {
    await resetCounters()
    const { call, fetchSpy } = setup()
    expect((await call(null)).status).toBe(401)
    expect((await call('forged-token')).status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await db.query(`select 1 from public.rate_limits`)).rows).toHaveLength(0)
  })
  it('answers preflight and refuses other methods', async () => {
    const { call } = setup()
    expect((await call(null, { method: 'OPTIONS' })).status).toBe(204)
    expect((await call('ta', { method: 'GET' })).status).toBe(405)
  })
})

describe("the Place ID always comes from the caller's own business", () => {
  it("ignores another business's Place ID sent in the body, the query string or headers", async () => {
    await resetCounters()
    const { call, fetchSpy } = setup()
    const r = await call('ta', {
      body: { place_id: PLACE_B, placeId: PLACE_B, business_id: b.businessId, id: PLACE_B },
      query: `?place_id=${PLACE_B}&placeId=${PLACE_B}&fields=*`,
      headers: { 'x-place-id': PLACE_B, 'x-business-id': b.businessId },
    })
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://places.googleapis.com/v1/places/${PLACE_A}`)
    expect(JSON.stringify([url, init])).not.toContain(PLACE_B)
  })

  it("business B's request looks up B's listing, never A's", async () => {
    await resetCounters()
    const { call, fetchSpy } = setup()
    await call('tb', { body: { place_id: PLACE_A } })
    expect((fetchSpy.mock.calls[0] as unknown as [string])[0]).toBe(`https://places.googleapis.com/v1/places/${PLACE_B}`)
  })

  it('answers "no listing connected" without calling Google or using any allowance', async () => {
    await resetCounters()
    const { call, fetchSpy } = setup()
    const r = await call('tc', { body: { place_id: PLACE_A } }) // the body is ignored: there is still no listing
    expect(r).toMatchObject({ status: 404, json: { error: 'no_listing' } })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await db.query(`select 1 from public.rate_limits`)).rows).toHaveLength(0)
  })

  it('answers "no business" for an account that never created one', async () => {
    const { call, fetchSpy } = setup({ getUser: async () => ({ id: '99999999-9999-4999-8999-999999999999' }) })
    expect(await call('anything')).toMatchObject({ status: 404, json: { error: 'no_business' } })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a malformed stored Place ID rather than putting it into a URL', async () => {
    const { call, fetchSpy } = setup({ findOwnBusiness: async () => ({ id: a.businessId, place_id: '../../../admin?x=1' }) })
    expect((await call('ta')).json).toEqual({ error: 'no_listing' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('what is requested from Google, and what comes back', () => {
  it('asks for ONLY rating and userRatingCount, with the key in a header, as a bare GET', async () => {
    await resetCounters()
    const { call, fetchSpy } = setup()
    await call('ta')
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://places.googleapis.com/v1/places/${PLACE_A}`) // no query string at all
    expect(url).not.toContain('?')
    expect(url).not.toContain(KEY)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(init.headers).toEqual({ 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'rating,userRatingCount' })
  })

  it('returns exactly two values and nothing else Google sent', async () => {
    await resetCounters()
    const { call } = setup()
    const r = await call('ta')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ rating: 4.4, review_count: COUNT }) // 4.37 is shown to one decimal, as Google shows it
    expect(Object.keys(r.json).sort()).toEqual(['rating', 'review_count'])
    for (const leaked of ['Secret Display Name', 'Secret St', 'private review', '555-0100', PLACE_A, KEY, 'displayName', 'reviews']) expect(r.text, leaked).not.toContain(leaked)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })

  it('rounds the rating to one decimal and treats a listing with no reviews honestly', async () => {
    await resetCounters()
    const rounded = setup({}, async () => new Response(JSON.stringify({ rating: 4.666, userRatingCount: 12 })))
    expect((await rounded.call('ta')).json).toEqual({ rating: 4.7, review_count: 12 })
    await resetCounters()
    const none = setup({}, async () => new Response('{}'))
    expect((await none.call('ta')).json).toEqual({ rating: null, review_count: 0 })
  })

  it.each([
    ['a rating above 5', { rating: 7, userRatingCount: 3 }, { rating: null, review_count: 3 }],
    ['a rating that is text', { rating: '4.5', userRatingCount: 3 }, { rating: null, review_count: 3 }],
    ['a negative count', { rating: 4, userRatingCount: -5 }, { rating: 4, review_count: 0 }],
    ['a fractional count', { rating: 4, userRatingCount: 2.5 }, { rating: 4, review_count: 0 }],
    ['a count that is text', { rating: 4, userRatingCount: '99' }, { rating: 4, review_count: 0 }],
  ])('copes with %s from Google', async (_label, google, expected) => {
    await resetCounters()
    const { call } = setup({}, async () => new Response(JSON.stringify(google)))
    expect((await call('ta')).json).toEqual(expected)
  })
})

describe('caps', () => {
  it('lets a business check 5 times a day and stops the 6th, without calling Google', async () => {
    await resetCounters()
    const { call, fetchSpy } = setup()
    for (let i = 1; i <= 5; i++) expect((await call('ta')).status, `check ${i}`).toBe(200)
    const blocked = await call('ta')
    expect(blocked).toMatchObject({ status: 429, json: { error: 'business_cap' } })
    expect(blocked.headers.get('retry-after')).toBe('86400')
    expect(fetchSpy).toHaveBeenCalledTimes(5)
  })

  it("counts each business separately: one business's limit doesn't block another", async () => {
    await resetCounters()
    const { call } = setup()
    for (let i = 0; i < 5; i++) await call('ta')
    expect((await call('ta')).json).toEqual({ error: 'business_cap' })
    expect((await call('tb')).status).toBe(200)
  })

  it('stops everyone once 30 checks have been made across all businesses, with the "busy" code', async () => {
    await resetCounters()
    const ids = Array.from({ length: 31 }, (_, i) => `${(i + 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`)
    const { call, fetchSpy } = setup({
      getUser: async (t) => ({ id: t }),
      findOwnBusiness: async (userId) => ({ id: userId, place_id: PLACE_A }),
    })
    for (let i = 0; i < 30; i++) expect((await call(ids[i])).status, `business ${i + 1}`).toBe(200)
    const busy = await call(ids[30])
    expect(busy).toMatchObject({ status: 429, json: { error: 'google_busy' } })
    expect(fetchSpy).toHaveBeenCalledTimes(30)
    // a business that hasn't used any of its own allowance is still stopped by the shared one
    expect((await call(ids[0])).json).toEqual({ error: 'google_busy' })
  })

  it('a business that has hit its own limit never spends the shared allowance', async () => {
    await resetCounters()
    const { call } = setup()
    for (let i = 0; i < 5; i++) await call('ta')
    const before = await counter('gratings:global')
    expect(before).toBe(5)
    for (let i = 0; i < 20; i++) expect((await call('ta')).json).toEqual({ error: 'business_cap' })
    expect(await counter('gratings:global')).toBe(before)
  })

  it('honours smaller caps passed in (so the numbers really are configurable), checking the business first', async () => {
    await resetCounters()
    const { call, fetchSpy } = setup({ perBusinessPerDay: 2, globalPerDay: 3 })
    expect((await call('ta')).status).toBe(200)
    expect((await call('ta')).status).toBe(200)
    expect((await call('ta')).json).toEqual({ error: 'business_cap' })
    expect((await call('tb')).status).toBe(200)
    expect((await call('tb')).json).toEqual({ error: 'google_busy' }) // 3 checks used overall
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('counts by UTC day (both counters share the same window), and the counters hold only counts', async () => {
    await resetCounters()
    const { call } = setup()
    await call('ta')
    const rows = await db.query<{ key: string; secs: string; count: number }>(`select key, (extract(epoch from window_start)::bigint % 86400)::text as secs, count from public.rate_limits`)
    expect(rows.rows.map((r) => r.key).sort()).toEqual([`gratings:biz:${a.businessId}`, 'gratings:global'].sort())
    for (const r of rows.rows) {
      expect(r.secs).toBe('0') // windows start at 00:00 UTC
      expect(r.count).toBe(1)
    }
  })
})

describe('errors are friendly, generic, and leak nothing', () => {
  it('maps Google failures to "unavailable" with no Google text, and a missing listing to its own code', async () => {
    for (const status of [400, 403, 429, 500, 503]) {
      await resetCounters()
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { call } = setup({}, async () => new Response(JSON.stringify({ error: { message: `key ${KEY} rejected, rating ${RATING}` } }), { status }))
      const r = await call('ta')
      const logged = JSON.stringify(spy.mock.calls)
      spy.mockRestore()
      expect(r, String(status)).toMatchObject({ status: 502, json: { error: 'google_unavailable' } })
      expect(r.text + logged).not.toMatch(/AIza|rejected|4\.37/)
    }
    await resetCounters()
    const gone = setup({}, async () => new Response('{}', { status: 404 }))
    expect((await gone.call('ta')).json).toEqual({ error: 'listing_not_found' })
  })

  it('handles a network failure, a timeout and an unreadable response', async () => {
    for (const impl of [
      async () => { throw new TypeError(`fetch failed for ${KEY}`) },
      async () => { throw new DOMException('timed out', 'TimeoutError') },
      async () => new Response('<html>not json</html>', { status: 200 }),
    ]) {
      await resetCounters()
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const r = await setup({}, impl as unknown as typeof fetch).call('ta')
      const logged = JSON.stringify(spy.mock.calls)
      spy.mockRestore()
      expect(r).toMatchObject({ status: 502, json: { error: 'google_unavailable' } })
      expect(r.text + logged).not.toContain(KEY)
    }
  })

  it('fails closed with no key configured, before using any allowance', async () => {
    await resetCounters()
    const { call, fetchSpy } = setup({ googleApiKey: null })
    expect(await call('ta')).toMatchObject({ status: 500, json: { error: 'server_misconfigured' } })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await db.query(`select 1 from public.rate_limits`)).rows).toHaveLength(0)
  })
})

describe('nothing from Google is stored or logged', () => {
  const dump = async () => {
    const tables = (await db.query<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'rate_limits' order by 1`)).rows
    const out: Record<string, string> = {}
    for (const { t } of tables) out[t] = (await db.query<{ d: string }>(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as d from public.${t} x`)).rows[0].d
    return out
  }

  it('leaves every table (apart from the counters) exactly as it was, and no value appears anywhere in the database', async () => {
    await resetCounters()
    const before = await dump()
    const { call } = setup()
    for (const t of ['ta', 'tb', 'ta']) await call(t)
    expect(await dump()).toEqual(before)
    for (const needle of ['4.37', '1234', 'Secret Display Name', 'private review', '555-0100', KEY]) expect(await dbContains(db, needle), needle).toBe(false)
    const keys = (await db.query<{ key: string }>(`select key from public.rate_limits`)).rows.map((r) => r.key)
    for (const k of keys) expect(k).toMatch(/^gratings:(global|biz:[0-9a-f-]{36})$/)
  })

  it('never logs the rating, the count, the Place ID or the key, on success or failure', async () => {
    await resetCounters()
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const good = setup()
    await good.call('ta')
    await resetCounters()
    await setup({}, async () => new Response('x', { status: 500 })).call('ta')
    await resetCounters()
    await setup({}, async () => { throw new Error(`boom ${KEY} ${PLACE_A} ${RATING}`) }).call('ta')
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    spies.forEach((s) => s.mockRestore())
    for (const needle of ['4.37', '1234', PLACE_A, PLACE_B, KEY, 'Secret']) expect(logged, needle).not.toContain(needle)
  })
})
