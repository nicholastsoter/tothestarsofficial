import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, createDb, createTenant, type Tenant } from './helpers'

let db: PGlite
let a: Tenant
let b: Tenant
let la: Tenant
let nz: Tenant
let india: Tenant
let utc: Tenant

const as$ = (t: Tenant) => <T>(fn: () => Promise<T>) => as(db, 'authenticated', t.userId, fn)
const fbAt = (t: Tenant, iso: string, star: number) =>
  db.query(`insert into public.feedback (business_id, star_rating, created_at) values ($1, $2, $3::timestamptz)`, [t.businessId, star, iso])
const clickAt = (t: Tenant, iso: string, star: number | null) =>
  db.query(`insert into public.events (business_id, type, star_rating, created_at) values ($1, 'google_link_click', $2, $3::timestamptz)`, [t.businessId, star, iso])
const setTz = (t: Tenant, tz: string) => db.query(`update public.businesses set timezone = $1 where id = $2`, [tz, t.businessId])

interface Row { star: number; ratings: number; clicks: number; counted: number; ctr: number | null }
const ctr = async (t: Tenant, from: string | null, to: string | null): Promise<Row[]> =>
  (
    await as$(t)(() =>
      db.query<Row>(`select star, ratings::int, clicks::int, counted_clicks::int as counted, click_through::float as ctr from public.analytics_google_ctr($1::date, $2::date)`, [from, to]),
    )
  ).rows
const byStar = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.star, r]))

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
  la = await createTenant(db, 'LA Diner', 'la-diner')
  nz = await createTenant(db, 'NZ Diner', 'nz-diner')
  india = await createTenant(db, 'India Diner', 'india-diner')
  utc = await createTenant(db, 'UTC Diner', 'utc-diner')
  await setTz(a, 'UTC')
  await setTz(b, 'UTC')
  await setTz(la, 'America/Los_Angeles')
  await setTz(nz, 'Pacific/Auckland')
  await setTz(india, 'Asia/Kolkata')
  await setTz(utc, 'UTC')
})

describe('access control', () => {
  it('only logged-in owners may call it; it is security invoker and takes no business id', async () => {
    await expect(as(db, 'anon', null, () => db.query(`select * from public.analytics_google_ctr(null, null)`))).rejects.toThrow(/permission denied/)
    await expect(as$(a)(() => db.query(`select * from public.analytics_google_ctr(null, null)`))).resolves.toBeDefined()
    const f = await db.query<{ prosecdef: boolean; args: string }>(`select prosecdef, pg_get_function_arguments(oid) as args from pg_proc where proname = 'analytics_google_ctr'`)
    expect(f.rows).toHaveLength(1)
    expect(f.rows[0].prosecdef).toBe(false)
    expect(f.rows[0].args).not.toMatch(/business|owner|user/i)
  })

  it('an account with no business gets nothing back', async () => {
    const u = await db.query<{ id: string }>(`insert into auth.users (email) values ('nobiz-ctr@example.com') returning id`)
    expect(await ctr({ userId: u.rows[0].id } as Tenant, null, null)).toHaveLength(0)
  })
})

describe('business A cannot see business B numbers', () => {
  beforeAll(async () => {
    for (const s of [5, 5, 4]) await fbAt(a, '2025-06-10T12:00:00Z', s)
    await clickAt(a, '2025-06-10T12:05:00Z', 5)
    for (const s of [1, 1, 1, 2]) await fbAt(b, '2025-06-10T12:00:00Z', s)
    for (let i = 0; i < 9; i++) await clickAt(b, '2025-06-10T12:05:00Z', 1)
  })
  it('each owner sees only their own ratings and clicks, even with an all-time range', async () => {
    const ra = byStar(await ctr(a, null, null))
    expect(ra[5]).toMatchObject({ ratings: 2, clicks: 1 })
    expect(ra[4]).toMatchObject({ ratings: 1, clicks: 0 })
    expect(ra[1]).toMatchObject({ ratings: 0, clicks: 0 }) // B's 1-star ratings and clicks are invisible to A
    const rb = byStar(await ctr(b, '2025-06-01', '2025-06-30'))
    expect(rb[1]).toMatchObject({ ratings: 3, clicks: 9 })
    expect(rb[5]).toMatchObject({ ratings: 0, clicks: 0 })
  })
})

describe('percentages', () => {
  let t: Tenant
  beforeAll(async () => {
    t = await createTenant(db, 'Pct Cafe', 'pct-cafe')
    await setTz(t, 'UTC')
    // 5 stars: 4 ratings, 1 click    -> 25%
    for (let i = 0; i < 4; i++) await fbAt(t, '2025-04-01T10:00:00Z', 5)
    await clickAt(t, '2025-04-01T10:01:00Z', 5)
    // 4 stars: 2 ratings, 2 clicks   -> 100%
    for (let i = 0; i < 2; i++) { await fbAt(t, '2025-04-01T10:00:00Z', 4); await clickAt(t, '2025-04-01T10:01:00Z', 4) }
    // 3 stars: 2 ratings, 7 clicks   -> repeat clicks: capped at 100%, raw clicks still reported
    for (let i = 0; i < 2; i++) await fbAt(t, '2025-04-01T10:00:00Z', 3)
    for (let i = 0; i < 7; i++) await clickAt(t, '2025-04-01T10:01:00Z', 3)
    // 2 stars: 3 ratings, 0 clicks   -> 0%
    for (let i = 0; i < 3; i++) await fbAt(t, '2025-04-01T10:00:00Z', 2)
    // 1 star: 0 ratings, 3 clicks    -> no rate (nothing to divide by), and nothing counted
    for (let i = 0; i < 3; i++) await clickAt(t, '2025-04-01T10:01:00Z', 1)
  })

  it('divides counted clicks by ratings, per star', async () => {
    const r = byStar(await ctr(t, '2025-04-01', '2025-04-01'))
    expect(r[5]).toEqual({ star: 5, ratings: 4, clicks: 1, counted: 1, ctr: 0.25 })
    expect(r[4]).toEqual({ star: 4, ratings: 2, clicks: 2, counted: 2, ctr: 1 })
    expect(r[2]).toEqual({ star: 2, ratings: 3, clicks: 0, counted: 0, ctr: 0 })
  })

  it('never exceeds 100% when clicks outnumber ratings, and still reports the raw clicks', async () => {
    const r = byStar(await ctr(t, '2025-04-01', '2025-04-01'))
    expect(r[3]).toEqual({ star: 3, ratings: 2, clicks: 7, counted: 2, ctr: 1 })
  })

  it('has no rate (null, not zero and not an error) when a star has no ratings', async () => {
    const r = byStar(await ctr(t, '2025-04-01', '2025-04-01'))
    expect(r[1]).toEqual({ star: 1, ratings: 0, clicks: 3, counted: 0, ctr: null })
  })

  it('always returns the five stars, even for an empty range, with no division by zero', async () => {
    const rows = await ctr(t, '2024-01-01', '2024-01-02')
    expect(rows.map((r) => r.star)).toEqual([1, 2, 3, 4, 5])
    expect(rows.every((r) => r.ratings === 0 && r.clicks === 0 && r.ctr === null)).toBe(true)
  })

  it('keeps every rate within 0..1 for many random combinations of ratings and clicks', async () => {
    let seed = 12345
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    const p = await createTenant(db, 'Prop Cafe', 'prop-cafe')
    await setTz(p, 'UTC')
    for (let day = 1; day <= 28; day++) {
      const stamp = `2025-02-${String(day).padStart(2, '0')}T12:00:00Z`
      for (let star = 1; star <= 5; star++) {
        const ratings = Math.floor(rnd() * 6)
        const clicks = Math.floor(rnd() * 12)
        for (let i = 0; i < ratings; i++) await fbAt(p, stamp, star)
        for (let i = 0; i < clicks; i++) await clickAt(p, stamp, star)
      }
      const rows = (await ctr(p, `2025-02-${String(day).padStart(2, '0')}`, `2025-02-${String(day).padStart(2, '0')}`)).filter((r) => r.star >= 1)
      for (const r of rows) {
        expect(r.counted, `day ${day} star ${r.star}`).toBeLessThanOrEqual(r.ratings)
        expect(r.counted).toBeLessThanOrEqual(r.clicks)
        if (r.ctr !== null) {
          expect(r.ctr).toBeGreaterThanOrEqual(0)
          expect(r.ctr).toBeLessThanOrEqual(1)
        } else {
          expect(r.ratings).toBe(0)
        }
      }
    }
    const all = await ctr(p, '2025-02-01', '2025-02-28')
    for (const r of all.filter((x) => x.star >= 1)) expect(r.ctr === null || (r.ctr >= 0 && r.ctr <= 1)).toBe(true)
  })
})

describe('clicks with no star recorded', () => {
  it('appear as one extra row (star 0) so no click goes missing, and never count toward a star', async () => {
    const t = await createTenant(db, 'Nostar Cafe', 'nostar-cafe')
    await setTz(t, 'UTC')
    await fbAt(t, '2025-05-01T10:00:00Z', 5)
    await clickAt(t, '2025-05-01T10:01:00Z', 5)
    await clickAt(t, '2025-05-01T10:02:00Z', null)
    await clickAt(t, '2025-05-01T10:03:00Z', null)
    const rows = await ctr(t, '2025-05-01', '2025-05-01')
    expect(rows.map((r) => r.star)).toEqual([0, 1, 2, 3, 4, 5])
    expect(rows[0]).toEqual({ star: 0, ratings: 0, clicks: 2, counted: 0, ctr: null })
    expect(byStar(rows)[5]).toMatchObject({ ratings: 1, clicks: 1, ctr: 1 })
  })
  it('has no star-0 row when every click has a star', async () => {
    expect((await ctr(a, null, null)).some((r) => r.star === 0)).toBe(false)
  })
})

describe('a click recorded by the public page carries the star end to end', () => {
  it('public_track_event stores the star, and it shows up under that star', async () => {
    const t = await createTenant(db, 'E2E Cafe', 'e2e-cafe')
    await setTz(t, 'UTC')
    await db.query(`insert into public.feedback (business_id, star_rating) values ($1, 3), ($1, 3)`, [t.businessId])
    await as(db, 'service_role', null, () => db.query(`select public.public_track_event('e2e-cafe', 'google_link_click', 3)`))
    await as(db, 'service_role', null, () => db.query(`select public.public_track_event('e2e-cafe', 'google_link_click', 3)`))
    const stored = await db.query<{ star_rating: number }>(`select star_rating from public.events where business_id = $1 and type = 'google_link_click'`, [t.businessId])
    expect(stored.rows.map((r) => r.star_rating)).toEqual([3, 3])
    const today = (await db.query<{ d: string }>(`select (now() at time zone 'UTC')::date::text as d`)).rows[0].d
    expect(byStar(await ctr(t, today, today))[3]).toMatchObject({ ratings: 2, clicks: 2, ctr: 1 })
  })
})

describe('local-midnight boundaries (ratings and clicks use the same local day)', () => {
  const day = (rows: Row[], star: number) => byStar(rows)[star]

  it('Los Angeles on the spring-forward day (2025-03-09 has 23 hours)', async () => {
    for (const iso of ['2025-03-09T07:59:59Z', '2025-03-09T08:00:00Z', '2025-03-10T06:59:59Z', '2025-03-10T07:00:00Z']) {
      await fbAt(la, iso, 4)
      await clickAt(la, iso, 4)
    }
    expect(day(await ctr(la, '2025-03-09', '2025-03-09'), 4)).toMatchObject({ ratings: 2, clicks: 2 })
    expect(day(await ctr(la, '2025-03-08', '2025-03-08'), 4)).toMatchObject({ ratings: 1, clicks: 1 })
    expect(day(await ctr(la, '2025-03-10', '2025-03-10'), 4)).toMatchObject({ ratings: 1, clicks: 1 })
  })

  it('Auckland on the daylight-saving end day (2025-04-06 has 25 hours)', async () => {
    for (const iso of ['2025-04-05T10:59:59Z', '2025-04-05T11:00:00Z', '2025-04-06T11:59:59Z', '2025-04-06T12:00:00Z']) {
      await fbAt(nz, iso, 5)
      await clickAt(nz, iso, 5)
    }
    expect(day(await ctr(nz, '2025-04-06', '2025-04-06'), 5)).toMatchObject({ ratings: 2, clicks: 2 })
    expect(day(await ctr(nz, '2025-04-05', '2025-04-05'), 5)).toMatchObject({ ratings: 1, clicks: 1 })
    expect(day(await ctr(nz, '2025-04-07', '2025-04-07'), 5)).toMatchObject({ ratings: 1, clicks: 1 })
  })

  it('Kolkata (UTC+5:30)', async () => {
    await fbAt(india, '2025-03-01T18:29:59Z', 2)
    await clickAt(india, '2025-03-01T18:30:00Z', 2) // a click just after local midnight, its rating just before
    expect(day(await ctr(india, '2025-03-01', '2025-03-01'), 2)).toMatchObject({ ratings: 1, clicks: 0 })
    expect(day(await ctr(india, '2025-03-02', '2025-03-02'), 2)).toMatchObject({ ratings: 0, clicks: 1, ctr: null })
  })
})

describe('the numbers agree with the rest of Analytics', () => {
  it('stars add up to the same ratings and Google clicks as the summary cards, for every range', async () => {
    const t = await createTenant(db, 'Agree Cafe', 'agree-cafe')
    await setTz(t, 'America/Los_Angeles')
    let seed = 99
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < 160; i++) {
      const iso = new Date(Date.UTC(2025, 2, 1) + Math.floor(rnd() * 20 * 86_400_000)).toISOString() // 1-20 March 2025: covers the DST change
      const star = 1 + Math.floor(rnd() * 5)
      if (rnd() < 0.6) await fbAt(t, iso, star)
      if (rnd() < 0.5) await clickAt(t, iso, rnd() < 0.1 ? null : star)
    }
    for (const [from, to] of [['2025-03-01', '2025-03-20'], ['2025-03-09', '2025-03-09'], ['2025-03-08', '2025-03-10'], [null, null]] as const) {
      const rows = await ctr(t, from, to)
      const sum = (await as$(t)(() => db.query<{ ratings: number; clicks: number }>(`select ratings::int, google_clicks::int as clicks from public.analytics_summary($1::date, $2::date)`, [from, to]))).rows[0]
      expect(rows.reduce((n, r) => n + r.ratings, 0), `${from}..${to} ratings`).toBe(sum.ratings)
      expect(rows.reduce((n, r) => n + r.clicks, 0), `${from}..${to} clicks`).toBe(sum.clicks)
    }
  })

  it('daily, weekly and monthly series always add up to the summary for the same range (so the Overview charts and headline numbers agree)', async () => {
    const t = await createTenant(db, 'Series Cafe', 'series-cafe')
    await setTz(t, 'America/Los_Angeles')
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < 200; i++) {
      const iso = new Date(Date.UTC(2025, 1, 15) + Math.floor(rnd() * 60 * 86_400_000)).toISOString() // mid-Feb to mid-April 2025
      if (rnd() < 0.7) await fbAt(t, iso, 1 + Math.floor(rnd() * 5))
      if (rnd() < 0.8) await db.query(`insert into public.events (business_id, type, created_at) values ($1, 'page_view', $2::timestamptz)`, [t.businessId, iso])
      if (rnd() < 0.4) await clickAt(t, iso, 1 + Math.floor(rnd() * 5))
    }
    for (const [from, to] of [['2025-02-15', '2025-04-15'], ['2025-03-01', '2025-03-31'], ['2025-03-05', '2025-03-12'], ['2025-02-01', '2025-04-30']] as const) {
      const sum = (await as$(t)(() => db.query<{ r: number; v: number; c: number }>(`select ratings::int r, page_views::int v, google_clicks::int c from public.analytics_summary($1::date, $2::date)`, [from, to]))).rows[0]
      for (const bucket of ['day', 'week', 'month']) {
        const s = (await as$(t)(() => db.query<{ r: number; v: number; c: number }>(`select coalesce(sum(ratings), 0)::int r, coalesce(sum(page_views), 0)::int v, coalesce(sum(google_clicks), 0)::int c from public.analytics_timeseries($1::date, $2::date, $3)`, [from, to, bucket]))).rows[0]
        expect(s, `${from}..${to} by ${bucket}`).toEqual(sum)
      }
    }
  })
})

describe('nothing new is stored', () => {
  it('this phase added no table', async () => {
    const t = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)
    expect(t.rows.map((r) => r.table_name)).toEqual(['businesses', 'events', 'feedback', 'feedback_secrets', 'rate_limits', 'slug_history', 'survey_questions', 'surveys'])
  })
})
