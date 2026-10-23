import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createPlacesSearchHandler, type PlacesSearchDeps } from '../functions/places-search/handler'
import { createDb, pgRpc } from './helpers'

const KEY = 'AIzaSy-SECRET-GOOGLE-KEY-123456'
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'

let db: PGlite
beforeAll(async () => {
  db = await createDb()
})

const googleOk = (suggestions: unknown[]) => new Response(JSON.stringify({ suggestions }), { status: 200 })
const prediction = (i: number, extra: Record<string, unknown> = {}) => ({
  placePrediction: {
    place: `places/ChIJ${i}`,
    placeId: `ChIJ-place-id-${i}xxxxxxxx`,
    text: { text: `Cafe ${i}, 1 Main St, Austin, TX, USA`, matches: [] },
    structuredFormat: { mainText: { text: `Cafe ${i}`, matches: [] }, secondaryText: { text: '1 Main St, Austin, TX, USA' } },
    types: ['cafe'],
    distanceMeters: 42,
    ...extra,
  },
})

function setup(over: Partial<PlacesSearchDeps> = {}, fetchImpl?: typeof fetch) {
  const fetchSpy = vi.fn(fetchImpl ?? (async () => googleOk([prediction(1)])))
  const deps: PlacesSearchDeps = {
    getUser: async (t) => (t === 'token-a' ? { id: USER_A } : t === 'token-b' ? { id: USER_B } : null),
    rpc: pgRpc(db),
    googleApiKey: KEY,
    fetch: fetchSpy as unknown as typeof fetch,
    ...over,
  }
  const handler = createPlacesSearchHandler(deps)
  const call = async (body: unknown, token: string | null = 'token-a', method = 'POST') => {
    const res = await handler(
      new Request('https://example.test/functions/v1/places-search', {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
      }),
    )
    const text = await res.text()
    return { status: res.status, text, json: text ? JSON.parse(text) : null }
  }
  return { call, fetchSpy }
}

describe('authentication', () => {
  it('rejects requests with no token or an invalid token, without calling Google', async () => {
    const { call, fetchSpy } = setup()
    expect((await call({ query: 'joes pizza' }, null)).status).toBe(401)
    expect((await call({ query: 'joes pizza' }, 'forged-token')).status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers preflight and refuses other methods', async () => {
    const { call } = setup()
    expect((await call(null, null, 'OPTIONS')).status).toBe(204)
    expect((await call(null, 'token-a', 'GET')).status).toBe(405)
  })
})

describe('input validation', () => {
  it.each([undefined, '', 'ab', '  a ', 'x'.repeat(101), 42, { q: 1 }])('rejects query %j', async (query) => {
    const { call, fetchSpy } = setup()
    const r = await call({ query })
    expect(r).toMatchObject({ status: 400, json: { error: 'invalid_query' } })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a malformed session token', async () => {
    const { call } = setup()
    expect((await call({ query: 'joes pizza', sessionToken: 'bad token!' })).status).toBe(400)
    expect((await call({ query: 'joes pizza', sessionToken: 12 })).status).toBe(400)
  })

  it('rejects oversize bodies', async () => {
    const { call } = setup()
    expect((await call({ query: 'joes pizza', junk: 'x'.repeat(5000) })).status).toBe(413)
  })
})

describe('rate limiting per account', () => {
  it('blocks an account after its hourly allowance without calling Google again', async () => {
    const { call, fetchSpy } = setup({ perHour: 3 })
    for (let i = 0; i < 3; i++) expect((await call({ query: 'joes pizza' }, 'token-a')).status).toBe(200)
    const blocked = await call({ query: 'joes pizza' }, 'token-a')
    expect(blocked).toMatchObject({ status: 429, json: { error: 'rate_limited' } })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('counts each account separately', async () => {
    const { call } = setup({ perHour: 1 })
    expect((await call({ query: 'some place' }, 'token-b')).status).toBe(200)
    expect((await call({ query: 'some place' }, 'token-b')).status).toBe(429)
    const other = setup({ perHour: 1 })
    expect((await other.call({ query: 'some place' }, 'token-a')).status).toBe(429) // already spent above
  })
})

describe('limits (20 per account per hour, 300 per day overall)', () => {
  it('defaults to 20 searches per account per hour', async () => {
    const { call, fetchSpy } = setup({ getUser: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) })
    for (let i = 0; i < 20; i++) expect((await call({ query: 'joes pizza' })).status, `request ${i + 1}`).toBe(200)
    const blocked = await call({ query: 'joes pizza' })
    expect(blocked).toMatchObject({ status: 429, json: { error: 'rate_limited' } })
    expect(fetchSpy).toHaveBeenCalledTimes(20)
  })

  it('stops ALL accounts once the daily cap is reached, with a friendly "busy" code', async () => {
    await db.query(`delete from public.rate_limits where key = 'places:global'`) // fresh day for this test
    const users: Record<string, string> = { t1: 'b1111111-1111-4111-8111-111111111111', t2: 'b2222222-2222-4222-8222-222222222222', t3: 'b3333333-3333-4333-8333-333333333333' }
    const { call, fetchSpy } = setup({ dailyCap: 2, perHour: 50, getUser: async (t) => (users[t] ? { id: users[t] } : null) })
    expect((await call({ query: 'cafe one' }, 't1')).status).toBe(200)
    expect((await call({ query: 'cafe two' }, 't2')).status).toBe(200)
    const busy = await call({ query: 'cafe three' }, 't3')
    expect(busy).toMatchObject({ status: 429, json: { error: 'search_busy' } })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    // a different account is blocked too, and the message is distinct from the per-account limit
    expect((await call({ query: 'cafe four' }, 't1')).json).toEqual({ error: 'search_busy' })
  })

  it("doesn't let a rate-limited account use up the global cap", async () => {
    const id = 'c4444444-4444-4444-8444-444444444444'
    const { call } = setup({ perHour: 1, dailyCap: 1000, getUser: async () => ({ id }) })
    await call({ query: 'cafe one' })
    const globalBefore = await db.query<{ count: number }>(`select coalesce(sum(count), 0)::int as count from public.rate_limits where key = 'places:global'`)
    for (let i = 0; i < 5; i++) expect((await call({ query: 'cafe again' })).json).toEqual({ error: 'rate_limited' })
    const globalAfter = await db.query<{ count: number }>(`select coalesce(sum(count), 0)::int as count from public.rate_limits where key = 'places:global'`)
    expect(globalAfter.rows[0].count).toBe(globalBefore.rows[0].count)
  })

  it('counts the global cap per UTC day (a one-day window)', async () => {
    const { call } = setup({ getUser: async () => ({ id: 'd5555555-5555-4555-8555-555555555555' }) })
    await call({ query: 'cafe window' })
    const r = await db.query<{ seconds: number }>(`select extract(epoch from (select max(window_start) from public.rate_limits where key = 'places:global'))::bigint % 86400 as seconds`)
    expect(Number(r.rows[0].seconds)).toBe(0) // windows start at 00:00 UTC
  })
})

describe('what is sent to and returned from Google', () => {
  it('sends the key in a header (never the URL) with a field mask, and nothing from the user but the query', async () => {
    const { call, fetchSpy } = setup()
    await call({ query: ' joes pizza ', sessionToken: 'session-12345678' }, 'token-b')
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete')
    expect(url).not.toContain(KEY)
    const headers = init.headers as Record<string, string>
    expect(headers['X-Goog-Api-Key']).toBe(KEY)
    expect(headers['X-Goog-FieldMask']).toContain('placePrediction.placeId')
    expect(JSON.parse(init.body as string)).toEqual({ input: 'joes pizza', sessionToken: 'session-12345678' })
  })

  it('returns only place_id, name and address, at most 5, dropping everything else Google sends', async () => {
    const many = [prediction(1), prediction(2), { queryPrediction: { text: { text: 'a query suggestion' } } }, prediction(3), prediction(4), prediction(5), prediction(6), prediction(7)]
    const { call } = setup({ getUser: async () => ({ id: '88888888-8888-4888-8888-888888888888' }) }, async () => googleOk(many))
    const r = await call({ query: 'cafe' })
    expect(r.status).toBe(200)
    expect(r.json.results).toHaveLength(5)
    for (const item of r.json.results) {
      expect(Object.keys(item).sort()).toEqual(['address', 'name', 'place_id'])
    }
    expect(r.json.results[0]).toEqual({ place_id: 'ChIJ-place-id-1xxxxxxxx', name: 'Cafe 1', address: '1 Main St, Austin, TX, USA' })
    expect(r.text).not.toMatch(/distanceMeters|types|cafe"|matches|places\/ChIJ/)
  })

  it('skips predictions with a malformed place id or no name', async () => {
    const { call } = setup({ getUser: async () => ({ id: '33333333-3333-4333-8333-333333333333' }) }, async () =>
      googleOk([prediction(1, { placeId: 'bad id!' }), prediction(2, { placeId: undefined }), { placePrediction: { placeId: 'ChIJ-valid-id-xxxxxx' } }, prediction(3)]),
    )
    const r = await call({ query: 'cafe' })
    expect(r.json.results.map((x: { name: string }) => x.name)).toEqual(['Cafe 3'])
  })

  it('returns an empty list when Google has no matches', async () => {
    const { call } = setup({ getUser: async () => ({ id: '44444444-4444-4444-8444-444444444444' }) }, async () => new Response('{}', { status: 200 }))
    expect((await call({ query: 'zzzzzzzz' })).json).toEqual({ results: [] })
  })

  it('never puts the API key in any response', async () => {
    const { call } = setup({ getUser: async () => ({ id: '55555555-5555-4555-8555-555555555555' }) })
    expect((await call({ query: 'cafe' })).text).not.toContain(KEY)
  })
})

describe('errors', () => {
  it('hides Google error details behind a generic 502', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { call } = setup(
      { getUser: async () => ({ id: '66666666-6666-4666-8666-666666666666' }) },
      async () => new Response(JSON.stringify({ error: { message: `API key ${KEY} is invalid` } }), { status: 403 }),
    )
    const r = await call({ query: 'cafe' })
    expect(r).toMatchObject({ status: 502, json: { error: 'upstream_error' } })
    expect(r.text).not.toMatch(/invalid|AIza/)
    expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY)
    spy.mockRestore()
  })

  it('handles a network failure or timeout', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { call } = setup({ getUser: async () => ({ id: '77777777-7777-4777-8777-777777777777' }) }, async () => {
      throw new Error(`connect failed for ${KEY}`)
    })
    const r = await call({ query: 'cafe' })
    expect(r).toMatchObject({ status: 502, json: { error: 'upstream_error' } })
    expect(r.text).not.toContain(KEY)
    expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY)
    spy.mockRestore()
  })

  it('fails closed when the Google key is not configured', async () => {
    const { call, fetchSpy } = setup({ googleApiKey: null })
    expect(await call({ query: 'cafe' })).toMatchObject({ status: 500, json: { error: 'server_misconfigured' } })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
