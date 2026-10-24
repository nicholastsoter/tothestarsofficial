import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, createDb, createTenant, type Tenant } from './helpers'

let db: PGlite
let a: Tenant // Chicago, with its own numbers
let b: Tenant // Chicago, with different numbers
let la: Tenant
let nz: Tenant
let india: Tenant
let utc: Tenant

const FUNCS = [
  'analytics_context()',
  "analytics_summary('2025-01-01', '2025-12-31')",
  "analytics_timeseries('2025-01-01', '2025-01-31', 'day')",
  "analytics_distribution('2025-01-01', '2025-12-31')",
  'analytics_before_after(90)',
]

const as$ = (t: Tenant) => <T>(fn: () => Promise<T>) => as(db, 'authenticated', t.userId, fn)
const fbAt = (t: Tenant, iso: string, star = 4, message: string | null = null) =>
  db.query(`insert into public.feedback (business_id, star_rating, message, created_at) values ($1, $2, $3, $4::timestamptz)`, [t.businessId, star, message, iso])
const evAt = (t: Tenant, iso: string, type: string, star: number | null = null) =>
  db.query(`insert into public.events (business_id, type, star_rating, created_at) values ($1, $2, $3, $4::timestamptz)`, [t.businessId, type, star, iso])
const setTz = (t: Tenant, tz: string) => db.query(`update public.businesses set timezone = $1 where id = $2`, [tz, t.businessId])

interface Day { day: string; n: number; avg: number | null; pv: number; gc: number; s1: number; s2: number; s3: number; s4: number; s5: number }
const series = async (t: Tenant, from: string | null, to: string | null, bucket = 'day'): Promise<Day[]> =>
  (
    await as$(t)(() =>
      db.query<Day>(
        `select bucket_start::text as day, ratings::int as n, avg_rating::float as avg, page_views::int as pv, google_clicks::int as gc,
                star1::int as s1, star2::int as s2, star3::int as s3, star4::int as s4, star5::int as s5
           from public.analytics_timeseries($1::date, $2::date, $3)`,
        [from, to, bucket],
      ),
    )
  ).rows
const countsByDay = (rows: Day[]) => Object.fromEntries(rows.filter((r) => r.n > 0).map((r) => [r.day, r.n]))

interface Sum { page_views: number; star_taps: number; ratings: number; avg_rating: number | null; with_content: number; survey_completions: number; google_clicks: number }
const summary = async (t: Tenant, from: string | null, to: string | null): Promise<Sum[]> =>
  (
    await as$(t)(() =>
      db.query<Sum>(
        `select page_views::int, star_taps::int, ratings::int, avg_rating::float, with_content::int, survey_completions::int, google_clicks::int
           from public.analytics_summary($1::date, $2::date)`,
        [from, to],
      ),
    )
  ).rows

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
  la = await createTenant(db, 'LA Diner', 'la-diner')
  nz = await createTenant(db, 'NZ Diner', 'nz-diner')
  india = await createTenant(db, 'India Diner', 'india-diner')
  utc = await createTenant(db, 'UTC Diner', 'utc-diner')
  await setTz(la, 'America/Los_Angeles')
  await setTz(nz, 'Pacific/Auckland')
  await setTz(india, 'Asia/Kolkata')
  await setTz(utc, 'UTC')
})

describe('access control', () => {
  it.each(FUNCS)('%s: logged-in owners may call it, visitors may not', async (call) => {
    await expect(as(db, 'anon', null, () => db.query(`select * from public.${call}`))).rejects.toThrow(/permission denied/)
    await expect(as$(a)(() => db.query(`select * from public.${call}`))).resolves.toBeDefined()
  })

  it('every analytics function is SECURITY INVOKER (row level security applies) and takes no business id', async () => {
    const r = await db.query<{ proname: string; prosecdef: boolean; args: string | null }>(
      `select proname, prosecdef, pg_get_function_arguments(oid) as args from pg_proc
        where pronamespace = 'public'::regnamespace and proname like 'analytics\\_%'`,
    )
    expect(r.rows.map((x) => x.proname).sort()).toEqual(['analytics_before_after', 'analytics_context', 'analytics_distribution', 'analytics_google_ctr', 'analytics_summary', 'analytics_timeseries'])
    for (const f of r.rows) {
      expect(f.prosecdef, f.proname).toBe(false)
      expect(f.args ?? '', f.proname).not.toMatch(/business|owner|user/i)
    }
  })

  it('an account with no business gets nothing back', async () => {
    const u = await db.query<{ id: string }>(`insert into auth.users (email) values ('nobiz@example.com') returning id`)
    const nobody = { userId: u.rows[0].id, businessId: '', slug: '' } as Tenant
    expect((await summary(nobody, null, null))).toHaveLength(0)
    expect(await series(nobody, null, null)).toHaveLength(0)
    expect((await as$(nobody)(() => db.query(`select * from public.analytics_context()`))).rows).toHaveLength(0)
    expect((await as$(nobody)(() => db.query(`select * from public.analytics_distribution(null, null)`))).rows).toHaveLength(0)
    expect((await as$(nobody)(() => db.query(`select * from public.analytics_before_after(90)`))).rows).toHaveLength(0)
  })
})

describe('business A cannot see business B numbers', () => {
  beforeAll(async () => {
    // A: 3 ratings (5,5,4), 4 page views, 2 google clicks. B: 5 ratings (1,1,2,2,3), 9 page views, 7 google clicks.
    for (const s of [5, 5, 4]) await fbAt(a, '2025-06-10T15:00:00Z', s, 'A text')
    for (let i = 0; i < 4; i++) await evAt(a, '2025-06-10T15:00:00Z', 'page_view')
    for (let i = 0; i < 2; i++) await evAt(a, '2025-06-10T15:00:00Z', 'google_link_click', 5)
    for (const s of [1, 1, 2, 2, 3]) await fbAt(b, '2025-06-10T15:00:00Z', s, 'B text')
    for (let i = 0; i < 9; i++) await evAt(b, '2025-06-10T15:00:00Z', 'page_view')
    for (let i = 0; i < 7; i++) await evAt(b, '2025-06-10T15:00:00Z', 'google_link_click', 5)
  })

  it('summary: each owner sees only their own totals', async () => {
    expect(await summary(a, '2025-06-01', '2025-06-30')).toEqual([{ page_views: 4, star_taps: 0, ratings: 3, avg_rating: 4.67, with_content: 3, survey_completions: 0, google_clicks: 2 }])
    expect(await summary(b, '2025-06-01', '2025-06-30')).toEqual([{ page_views: 9, star_taps: 0, ratings: 5, avg_rating: 1.8, with_content: 5, survey_completions: 0, google_clicks: 7 }])
    // all time, no date limits: still isolated
    expect((await summary(a, null, null))[0].ratings).toBe(3)
    expect((await summary(b, null, null))[0].ratings).toBe(5)
  })

  it('timeseries, distribution and context are isolated too', async () => {
    const sa = await series(a, '2025-06-01', '2025-06-30')
    expect(sa.reduce((n, r) => n + r.n, 0)).toBe(3)
    expect(sa.reduce((n, r) => n + r.pv, 0)).toBe(4)
    const sb = await series(b, '2025-06-01', '2025-06-30')
    expect(sb.reduce((n, r) => n + r.n, 0)).toBe(5)

    const da = await as$(a)(() => db.query<{ star: number; n: number }>(`select star, ratings::int as n from public.analytics_distribution('2025-06-01', '2025-06-30')`))
    expect(da.rows.map((r) => r.n)).toEqual([0, 0, 0, 1, 2])
    const ctxA = await as$(a)(() => db.query<{ first_date: string }>(`select first_date::text from public.analytics_context()`))
    expect(ctxA.rows).toHaveLength(1)
  })

  it('a rival cannot widen the date range to reach into someone else’s data', async () => {
    expect((await summary(a, '1970-01-01', '2100-01-01'))[0].ratings).toBe(3)
    expect((await series(a, '2025-01-01', '2100-01-01')).reduce((n, r) => n + r.n, 0)).toBe(3) // the end is clamped to today
  })
})

describe('summary counts', () => {
  let s: Tenant
  beforeAll(async () => {
    s = await createTenant(db, 'Sum Cafe', 'sum-cafe')
    await setTz(s, 'UTC')
    // 6 star taps but only 5 feedback rows: ratings must come from feedback, not star_click events
    for (let i = 0; i < 6; i++) await evAt(s, '2025-02-10T12:00:00Z', 'star_click', 4)
    for (let i = 0; i < 10; i++) await evAt(s, '2025-02-10T12:00:00Z', 'page_view')
    for (let i = 0; i < 3; i++) await evAt(s, '2025-02-10T12:00:00Z', 'google_link_click', 5)
    for (let i = 0; i < 2; i++) await evAt(s, '2025-02-10T12:00:00Z', 'survey_completed', 2)
    for (const [star, msg] of [[5, null], [4, 'good'], [4, null], [2, 'meh'], [1, null]] as [number, string | null][]) await fbAt(s, '2025-02-10T12:00:00Z', star, msg)
    // outside the range
    await evAt(s, '2025-02-09T23:59:59Z', 'page_view')
    await evAt(s, '2025-02-11T00:00:00Z', 'page_view')
    await fbAt(s, '2025-02-09T23:59:59Z', 1)
    await fbAt(s, '2025-02-11T00:00:00Z', 1)
  })

  it('counts ratings from feedback rows (not star taps), content, survey completions and clicks', async () => {
    expect(await summary(s, '2025-02-10', '2025-02-10')).toEqual([
      { page_views: 10, star_taps: 6, ratings: 5, avg_rating: 3.2, with_content: 2, survey_completions: 2, google_clicks: 3 },
    ])
  })

  it('includes the whole of both end days and nothing outside them', async () => {
    expect((await summary(s, '2025-02-10', '2025-02-10'))[0].page_views).toBe(10) // 23:59:59 the day before and 00:00:00 the day after are excluded
    expect((await summary(s, '2025-02-09', '2025-02-11'))[0]).toMatchObject({ page_views: 12, ratings: 7 })
    expect((await summary(s, null, null))[0]).toMatchObject({ page_views: 12, ratings: 7 })
  })

  it('returns zeros and a null average for an empty range', async () => {
    expect(await summary(s, '2024-01-01', '2024-01-31')).toEqual([{ page_views: 0, star_taps: 0, ratings: 0, avg_rating: null, with_content: 0, survey_completions: 0, google_clicks: 0 }])
  })

  it('rounds the average to two decimals', async () => {
    const r = await createTenant(db, 'Round Cafe', 'round-cafe')
    for (const star of [5, 5, 4]) await fbAt(r, '2025-02-10T12:00:00Z', star)
    expect((await summary(r, '2025-02-10', '2025-02-10'))[0].avg_rating).toBe(4.67)
  })
})

describe('day buckets around local midnight', () => {
  it('Los Angeles, across the spring-forward day (2025-03-09 has 23 hours)', async () => {
    await fbAt(la, '2025-03-09T07:59:59Z', 3) // 23:59:59 PST on Mar 8
    await fbAt(la, '2025-03-09T08:00:00Z', 3) // 00:00:00 PST on Mar 9
    await fbAt(la, '2025-03-10T06:59:59Z', 3) // 23:59:59 PDT on Mar 9
    await fbAt(la, '2025-03-10T07:00:00Z', 3) // 00:00:00 PDT on Mar 10
    const rows = await series(la, '2025-03-08', '2025-03-10')
    expect(rows.map((r) => r.day)).toEqual(['2025-03-08', '2025-03-09', '2025-03-10'])
    expect(rows.map((r) => r.n)).toEqual([1, 2, 1])
    // the summary agrees about which instants belong to Mar 9
    expect((await summary(la, '2025-03-09', '2025-03-09'))[0].ratings).toBe(2)
  })

  it('Auckland, across the daylight-saving end day (2025-04-06 has 25 hours)', async () => {
    await fbAt(nz, '2025-04-05T10:59:59Z', 4) // 23:59:59 NZDT on Apr 5
    await fbAt(nz, '2025-04-05T11:00:00Z', 4) // 00:00:00 NZDT on Apr 6
    await fbAt(nz, '2025-04-06T11:59:59Z', 4) // 23:59:59 NZST on Apr 6
    await fbAt(nz, '2025-04-06T12:00:00Z', 4) // 00:00:00 NZST on Apr 7
    const rows = await series(nz, '2025-04-05', '2025-04-07')
    expect(rows.map((r) => r.n)).toEqual([1, 2, 1])
    expect((await summary(nz, '2025-04-06', '2025-04-06'))[0].ratings).toBe(2)
  })

  it('Kolkata (UTC+5:30): the half-hour offset moves the day boundary to 18:30 UTC', async () => {
    await fbAt(india, '2025-03-01T18:29:59Z', 5) // 23:59:59 on Mar 1
    await fbAt(india, '2025-03-01T18:30:00Z', 5) // 00:00:00 on Mar 2
    const rows = await series(india, '2025-03-01', '2025-03-02')
    expect(countsByDay(rows)).toEqual({ '2025-03-01': 1, '2025-03-02': 1 })
  })

  it('UTC: midnight is midnight', async () => {
    await fbAt(utc, '2025-03-01T23:59:59Z', 5)
    await fbAt(utc, '2025-03-02T00:00:00Z', 5)
    expect(countsByDay(await series(utc, '2025-03-01', '2025-03-02'))).toEqual({ '2025-03-01': 1, '2025-03-02': 1 })
  })

  it('page views and Google clicks use the same local-day rule as ratings', async () => {
    await evAt(la, '2025-05-02T06:59:59Z', 'page_view') // May 1 23:59:59 PDT
    await evAt(la, '2025-05-02T07:00:00Z', 'page_view') // May 2 00:00:00 PDT
    await evAt(la, '2025-05-02T07:00:00Z', 'google_link_click', 5)
    const rows = await series(la, '2025-05-01', '2025-05-02')
    expect(rows.map((r) => [r.day, r.pv, r.gc])).toEqual([['2025-05-01', 1, 0], ['2025-05-02', 1, 1]])
  })

  it('the same instant lands on different days for different businesses', async () => {
    const instant = '2025-07-01T03:00:00Z' // Jun 30 20:00 in LA, Jul 1 15:00 in Auckland, Jul 1 08:30 in Kolkata
    await fbAt(la, instant, 2)
    await fbAt(nz, instant, 2)
    await fbAt(india, instant, 2)
    expect(countsByDay(await series(la, '2025-06-29', '2025-07-02'))).toMatchObject({ '2025-06-30': 1 })
    expect(countsByDay(await series(nz, '2025-06-29', '2025-07-02'))).toMatchObject({ '2025-07-01': 1 })
    expect(countsByDay(await series(india, '2025-06-29', '2025-07-02'))).toMatchObject({ '2025-07-01': 1 })
  })
})

describe('week and month buckets', () => {
  it('weeks start on Monday in the business time zone, with a Monday label even when the range starts mid-week', async () => {
    await fbAt(la, '2025-03-10T06:59:59Z', 3) // Sun Mar 9 23:59:59 PDT: week of Mon Mar 3
    await fbAt(la, '2025-03-10T07:00:00Z', 3) // Mon Mar 10 00:00:00 PDT: week of Mar 10
    const rows = await series(la, '2025-03-05', '2025-03-16', 'week') // starts on a Wednesday
    expect(rows.map((r) => r.day)).toEqual(['2025-03-03', '2025-03-10'])
    // earlier tests left rows on Mar 8 (1) and Mar 9 (2) in the first week; this test adds one more on Sunday Mar 9.
    // The second week has the earlier Mar 10 row plus this test's Monday row.
    expect(rows[0].n).toBe(4)
    expect(rows[1].n).toBe(2)
  })

  it('months split at local midnight on the 1st, including across New Year', async () => {
    await fbAt(la, '2025-01-01T07:59:59Z', 4) // Dec 31 23:59:59 PST
    await fbAt(la, '2025-01-01T08:00:00Z', 4) // Jan 1 00:00:00 PST
    const rows = await series(la, '2024-12-01', '2025-01-31', 'month')
    expect(rows.map((r) => [r.day, r.n])).toEqual([['2024-12-01', 1], ['2025-01-01', 1]])
  })

  it('unknown bucket names fall back to days', async () => {
    const rows = await series(utc, '2025-03-01', '2025-03-03', 'fortnight; drop table feedback')
    expect(rows.map((r) => r.day)).toEqual(['2025-03-01', '2025-03-02', '2025-03-03'])
  })
})

describe('series shape', () => {
  it('includes empty buckets as zeros with a null average, so charts have no gaps', async () => {
    const rows = await series(utc, '2025-03-01', '2025-03-04')
    expect(rows).toHaveLength(4)
    expect(rows[2]).toMatchObject({ day: '2025-03-03', n: 0, avg: null, pv: 0, gc: 0, s1: 0, s5: 0 })
  })

  it('splits ratings by star and averages per bucket', async () => {
    const t = await createTenant(db, 'Stars Cafe', 'stars-cafe')
    await setTz(t, 'UTC')
    for (const s of [1, 2, 2, 5, 5, 5]) await fbAt(t, '2025-04-01T10:00:00Z', s)
    const row = (await series(t, '2025-04-01', '2025-04-01'))[0]
    expect(row).toMatchObject({ n: 6, avg: 3.33, s1: 1, s2: 2, s3: 0, s4: 0, s5: 3 })
  })

  it('stops at today even if the range ends in the future', async () => {
    const ctx = await as$(utc)(() => db.query<{ today: string }>(`select today::text from public.analytics_context()`))
    const rows = await series(utc, '2025-03-01', '2100-01-01', 'month')
    expect(rows.at(-1)!.day <= ctx.rows[0].today).toBe(true)
    expect(rows.length).toBeLessThan(200)
  })

  it('starts all-time at the first day with data, and shows today for a business with no data', async () => {
    const t = await createTenant(db, 'Fresh Cafe', 'fresh-cafe')
    await setTz(t, 'UTC')
    const empty = await series(t, null, null)
    expect(empty).toHaveLength(1)
    expect(empty[0].n).toBe(0)
    await fbAt(t, '2025-08-20T10:00:00Z', 5)
    const rows = await series(t, null, null)
    expect(rows[0].day).toBe('2025-08-20')
    expect(rows[0].n).toBe(1)
  })

  it('refuses an absurdly long range instead of building thousands of buckets', async () => {
    expect(await series(utc, '1900-01-01', '2025-01-01')).toHaveLength(0)
  })
})

describe('star distribution', () => {
  it('always returns five rows, zeros included, in star order', async () => {
    const r = await as$(utc)(() => db.query<{ star: number; n: number }>(`select star, ratings::int as n from public.analytics_distribution('2025-04-01', '2025-04-01')`))
    expect(r.rows.map((x) => x.star)).toEqual([1, 2, 3, 4, 5])
    expect(r.rows.map((x) => x.n)).toEqual([0, 0, 0, 0, 0])
    const t = await db.query<{ id: string }>(`select id from public.businesses where slug = 'stars-cafe'`)
    expect(t.rows).toHaveLength(1)
    const st = { userId: (await db.query<{ owner_user_id: string }>(`select owner_user_id from public.businesses where slug = 'stars-cafe'`)).rows[0].owner_user_id } as Tenant
    const d = await as$(st)(() => db.query<{ n: number }>(`select ratings::int as n from public.analytics_distribution('2025-04-01', '2025-04-01')`))
    expect(d.rows.map((x) => x.n)).toEqual([1, 2, 0, 0, 3])
  })
})

describe('before / after the tracking start date', () => {
  const makeBa = async (slug: string, startOffsetDays: number) => {
    const t = await createTenant(db, slug, slug)
    await db.query(`update public.businesses set timezone = 'UTC', tracking_start_date = (now() at time zone 'UTC')::date + $2::int where id = $1`, [t.businessId, startOffsetDays])
    return t
  }
  const ba = async (t: Tenant, max = 90) =>
    (
      await as$(t)(() =>
        db.query<{ period: string; from_date: string; to_date: string; days: number; ratings: number; avg: number | null; s4: number; s5: number }>(
          `select period, from_date::text, to_date::text, days, ratings::int, avg_rating::float as avg, star4::int as s4, star5::int as s5 from public.analytics_before_after($1)`, [max]),
      )
    ).rows
  const ago = (t: Tenant, days: number, star: number) =>
    db.query(`insert into public.feedback (business_id, star_rating, created_at) values ($1, $2, now() - ($3 || ' days')::interval)`, [t.businessId, star, String(days)])

  it('compares equal-length windows on each side of the start date', async () => {
    const t = await makeBa('ba-cafe', -10) // started 10 days ago: after = the last 11 days, before = the 11 days prior
    for (const s of [2, 3, 3]) await ago(t, 15, s)
    for (const s of [4, 5, 5, 4]) await ago(t, 5, s)
    const rows = await ba(t)
    expect(rows.map((r) => r.period)).toEqual(['before', 'after'])
    expect(rows[0].days).toBe(11)
    expect(rows[1].days).toBe(11)
    expect(rows[0]).toMatchObject({ ratings: 3, avg: 2.67 })
    expect(rows[1]).toMatchObject({ ratings: 4, avg: 4.5, s4: 2, s5: 2 })
    // the windows touch but don't overlap
    const nextDay = (await db.query<{ d: string }>(`select ($1::date + 1)::text as d`, [rows[0].to_date])).rows[0].d
    expect(nextDay).toBe(rows[1].from_date)
  })

  it('caps the window at p_max_days', async () => {
    const t = await makeBa('ba-cap', -40)
    expect((await ba(t, 7)).map((r) => r.days)).toEqual([7, 7])
    expect((await ba(t, 0)).map((r) => r.days)).toEqual([1, 1]) // nonsense input becomes one day
  })

  it('reports an empty "before" honestly (zero ratings, no average) instead of inventing one', async () => {
    const t = await makeBa('ba-new', -3)
    await ago(t, 1, 5)
    const rows = await ba(t)
    expect(rows[0]).toMatchObject({ period: 'before', ratings: 0, avg: null })
    expect(rows[1]).toMatchObject({ period: 'after', ratings: 1 })
  })

  it('returns nothing while the start date is still in the future', async () => {
    const t = await makeBa('ba-future', 5)
    expect(await ba(t)).toHaveLength(0)
  })

  it('on the start day itself it compares yesterday with today', async () => {
    const t = await makeBa('ba-today', 0)
    expect((await ba(t)).map((r) => r.days)).toEqual([1, 1])
  })

  it("is isolated: it only ever looks at the caller's own feedback", async () => {
    const t = await makeBa('ba-iso', -10)
    await ago(a, 5, 5) // someone else's rating inside the window
    expect((await ba(t)).every((r) => r.ratings === 0)).toBe(true)
  })
})

describe('context', () => {
  it('reports the time zone, local today, first data date and tracking start date', async () => {
    const r = await as$(la)(() => db.query<{ timezone: string; today: string; first_date: string; ts: string }>(`select timezone, today::text, first_date::text, tracking_start_date::text as ts from public.analytics_context()`))
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].timezone).toBe('America/Los_Angeles')
    expect(r.rows[0].first_date).toBe('2024-12-31') // 2025-01-01T07:59:59Z is still Dec 31 in Los Angeles
  })
})

describe('nothing new is stored', () => {
  it('Phase 4 added no tables, and no column anywhere holds Google ratings or review counts', async () => {
    const t = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)
    expect(t.rows.map((r) => r.table_name)).toEqual(['businesses', 'events', 'feedback', 'feedback_secrets', 'rate_limits', 'slug_history', 'survey_questions', 'surveys'])
    const c = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and column_name ~* '(google|review_count|rating_count|user_rating|userrating)'`,
    )
    expect(c.rows).toEqual([])
    // place_id is the one piece of Google data we keep, and it holds an identifier only
    const p = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name ~* 'place'`)
    expect(p.rows.map((r) => r.column_name)).toEqual(['place_id'])
  })

  it('deleting the account still removes everything (analytics reads tables only, so there is nothing extra to clean up)', async () => {
    const z = await createTenant(db, 'Zed Cafe', 'zed-cafe')
    await fbAt(z, '2025-06-01T12:00:00Z', 5)
    await evAt(z, '2025-06-01T12:00:00Z', 'page_view')
    await db.query(`delete from auth.users where id = $1`, [z.userId])
    for (const tbl of ['feedback', 'events', 'surveys', 'survey_questions']) {
      expect((await db.query(`select 1 from public.${tbl} where business_id = $1`, [z.businessId])).rows, tbl).toHaveLength(0)
    }
  })
})
