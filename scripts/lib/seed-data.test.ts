// @ts-nocheck (plain JavaScript module under test)
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { as, createDb } from '../../supabase/tests/helpers'
import { FAKE_LABEL, TEST_BUSINESS_NAME, addDays, assertSafeTarget, generateSeed, localToUtcIso, parseArgs } from './seed-data.mjs'

const REF = 'abcdefghijklmnopqrst'
const END = '2026-10-23'

describe('safety: refuses anything but the project you named', () => {
  it('accepts exactly the named project', () => {
    expect(assertSafeTarget({ projectRef: REF, supabaseUrl: `https://${REF}.supabase.co` })).toBe(`https://${REF}.supabase.co`)
    expect(assertSafeTarget({ projectRef: REF, supabaseUrl: `https://${REF}.supabase.co/` })).toBe(`https://${REF}.supabase.co`)
  })
  it.each([
    ['no project named', { projectRef: null, supabaseUrl: `https://${REF}.supabase.co` }, /--project-ref/],
    ['a malformed ref', { projectRef: 'prod', supabaseUrl: 'https://prod.supabase.co' }, /20-letter/],
    ['a URL for a different project', { projectRef: REF, supabaseUrl: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }, /exactly/],
    ['no URL', { projectRef: REF, supabaseUrl: undefined }, /SUPABASE_URL is not set/],
    ['a garbage URL', { projectRef: REF, supabaseUrl: 'not a url' }, /not a valid URL/],
    ['localhost', { projectRef: REF, supabaseUrl: 'http://localhost:54321' }, /exactly/],
    ['http instead of https', { projectRef: REF, supabaseUrl: `http://${REF}.supabase.co` }, /exactly/],
    ['a look-alike host', { projectRef: REF, supabaseUrl: `https://${REF}.supabase.co.evil.com` }, /exactly/],
    ['credentials smuggled in the URL', { projectRef: REF, supabaseUrl: `https://${REF}.supabase.co@evil.com` }, /exactly/],
    ['a username in the URL', { projectRef: REF, supabaseUrl: `https://user:pw@${REF}.supabase.co` }, /exactly/],
    ['a path', { projectRef: REF, supabaseUrl: `https://${REF}.supabase.co/rest/v1` }, /exactly/],
    ['a port', { projectRef: REF, supabaseUrl: `https://${REF}.supabase.co:8443` }, /exactly/],
  ])('refuses %s', (_label, input, message) => {
    expect(() => assertSafeTarget(input)).toThrow(message)
  })
  it('parses options, defaults to a dry run, and rejects unknown flags or silly sizes', () => {
    expect(parseArgs(['--project-ref', REF])).toEqual({ projectRef: REF, apply: false, remove: false, days: 120 })
    expect(parseArgs([`--project-ref=${REF}`, '--apply', '--days', '60'])).toMatchObject({ apply: true, days: 60 })
    expect(parseArgs(['--delete']).remove).toBe(true)
    expect(() => parseArgs(['--force'])).toThrow(/Unknown option/)
    expect(() => parseArgs(['--days', '3'])).toThrow(/14 to 400/)
    expect(() => parseArgs(['--days', 'many'])).toThrow(/14 to 400/)
  })
})

describe('time zones', () => {
  it('converts a wall-clock time in a zone to the right UTC instant, including daylight-saving days', () => {
    expect(localToUtcIso('2025-01-15', 12, 0, 0, 'America/Chicago')).toBe('2025-01-15T18:00:00.000Z') // CST, UTC-6
    expect(localToUtcIso('2025-07-15', 12, 0, 0, 'America/Chicago')).toBe('2025-07-15T17:00:00.000Z') // CDT, UTC-5
    expect(localToUtcIso('2025-03-09', 12, 0, 0, 'America/Los_Angeles')).toBe('2025-03-09T19:00:00.000Z') // after spring-forward
    expect(localToUtcIso('2025-03-09', 1, 30, 0, 'America/Los_Angeles')).toBe('2025-03-09T09:30:00.000Z') // before it
    expect(localToUtcIso('2025-04-06', 12, 0, 0, 'Pacific/Auckland')).toBe('2025-04-06T00:00:00.000Z') // NZST, UTC+12 (after the change)
    expect(localToUtcIso('2025-03-02', 0, 0, 0, 'Asia/Kolkata')).toBe('2025-03-01T18:30:00.000Z')
  })
  it('adds days across month and year ends', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('generated data', () => {
  const questions = [
    { id: '11111111-1111-4111-8111-111111111111', prompt: 'What fell short of your expectations?', type: 'multiple_choice', options: ['Service', 'Wait time', 'Price'] },
    { id: '22222222-2222-4222-8222-222222222222', prompt: 'Tell us more about what happened.', type: 'long_text', options: null },
  ]
  const data = generateSeed({ endDate: END, questions })

  it('is deterministic: the same seed gives identical data, a different seed does not', () => {
    expect(generateSeed({ endDate: END, questions })).toEqual(data)
    expect(generateSeed({ endDate: END, questions, seed: 2 }).feedback.length).not.toBe(data.feedback.length)
  })

  it('is plenty, and in the right shape', () => {
    expect(data.feedback.length).toBeGreaterThan(250)
    expect(data.events.length).toBeGreaterThan(data.feedback.length * 2)
    for (const f of data.feedback) {
      expect(f.star_rating).toBeGreaterThanOrEqual(1)
      expect(f.star_rating).toBeLessThanOrEqual(5)
      expect(['new', 'resolved']).toContain(f.status)
    }
    expect(new Set(data.events.map((e) => e.type))).toEqual(new Set(['page_view', 'star_click', 'survey_completed', 'google_link_click']))
    expect(data.events.filter((e) => e.type === 'star_click').length).toBe(data.feedback.length) // one star tap per rating
  })

  it('labels everything as fake', () => {
    expect(data.business.name).toBe(TEST_BUSINESS_NAME)
    expect(data.business.name).toMatch(/FAKE/)
    for (const f of data.feedback) {
      if (f.message) expect(f.message.startsWith(FAKE_LABEL)).toBe(true)
      if (f.private_note) expect(f.private_note.startsWith(FAKE_LABEL)).toBe(true)
      if (f.contact_name) expect(f.contact_name.startsWith(FAKE_LABEL)).toBe(true)
      if (f.contact_email) expect(f.contact_email).toMatch(/@example\.com$/)
      for (const a of f.survey_answers) if (a.type !== 'multiple_choice') expect(String(a.answer).startsWith(FAKE_LABEL)).toBe(true)
    }
  })

  it('opts in contact details only with consent, and only for low ratings', () => {
    for (const f of data.feedback) {
      if (f.contact_email) {
        expect(f.contact_consent).toBe(true)
        expect(f.star_rating).toBeLessThanOrEqual(3)
      }
    }
  })

  it('covers exactly the requested days, in the business time zone, and nothing in the future', () => {
    expect(data.startDate).toBe(addDays(END, -119))
    const inZone = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: data.business.timezone }).format(new Date(iso)) // yyyy-mm-dd
    for (const e of data.events.slice(0, 2000)) {
      const day = inZone(e.created_at)
      expect(day >= data.startDate).toBe(true)
      expect(day <= END).toBe(true)
    }
  })

  it('shows an improving average, with enough data before the tracking start date to compare', () => {
    const avg = (rows) => rows.reduce((n, r) => n + r.star_rating, 0) / rows.length
    const third = Math.floor(data.feedback.length / 3)
    expect(avg(data.feedback.slice(-third))).toBeGreaterThan(avg(data.feedback.slice(0, third)) + 0.4)
    const before = data.feedback.filter((f) => f.created_at < `${data.business.tracking_start_date}T00:00:00Z`)
    expect(before.length).toBeGreaterThanOrEqual(20)
  })

  it('only has survey answers on 1-3 star ratings, and a survey_completed event for each', () => {
    for (const f of data.feedback) if (f.survey_answers.length) expect(f.star_rating).toBeLessThanOrEqual(3)
    const withAnswers = data.feedback.filter((f) => f.survey_answers.length).length
    expect(data.events.filter((e) => e.type === 'survey_completed').length).toBe(withAnswers)
  })
})

describe('the fake data really works with the database and the analytics functions', () => {
  it('loads under every table constraint, and the SQL numbers equal an independent count of the same rows', async () => {
    const db = await createDb()
    const u = await db.query(`insert into auth.users (email) values ('fake-data-owner@example.com') returning id`)
    const userId = u.rows[0].id
    const seedFor = (qs) => generateSeed({ endDate: new Date().toISOString().slice(0, 10), timezone: 'Pacific/Auckland', questions: qs })
    const first = seedFor([])
    const biz = await db.query(
      `insert into public.businesses (owner_user_id, name, slug, timezone, tracking_start_date, goal_rating) values ($1, $2, $3, $4, $5, $6) returning id`,
      [userId, first.business.name, first.business.slug, first.business.timezone, first.business.tracking_start_date, first.business.goal_rating],
    )
    const businessId = biz.rows[0].id
    const qs = (await db.query(`select id, prompt, type, options from public.survey_questions where business_id = $1 order by position`, [businessId])).rows
    const seed = seedFor(qs)

    for (const f of seed.feedback) {
      await db.query(
        `insert into public.feedback (business_id, star_rating, message, survey_answers, contact_name, contact_email, contact_consent, status, private_note, created_at, updated_at)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)`,
        [businessId, f.star_rating, f.message, JSON.stringify(f.survey_answers), f.contact_name, f.contact_email, f.contact_consent, f.status, f.private_note, f.created_at, f.updated_at],
      )
    }
    for (const e of seed.events) await db.query(`insert into public.events (business_id, type, star_rating, created_at) values ($1, $2, $3, $4::timestamptz)`, [businessId, e.type, e.star_rating, e.created_at])

    // independent count in JavaScript, using the Intl time zone database
    const day = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Pacific/Auckland' }).format(new Date(iso))
    const from = seed.endDate
    const lastWeek = addDays(from, -6)
    const expected = (type) => seed.events.filter((e) => e.type === type && day(e.created_at) >= lastWeek && day(e.created_at) <= from).length
    const ratingsExpected = seed.feedback.filter((f) => day(f.created_at) >= lastWeek && day(f.created_at) <= from)

    const r = await as(db, 'authenticated', userId, () =>
      db.query(`select page_views::int pv, star_taps::int st, ratings::int n, survey_completions::int sc, google_clicks::int gc from public.analytics_summary($1::date, $2::date)`, [lastWeek, from]),
    )
    expect(r.rows[0]).toEqual({ pv: expected('page_view'), st: expected('star_click'), n: ratingsExpected.length, sc: expected('survey_completed'), gc: expected('google_link_click') })

    const ba = await as(db, 'authenticated', userId, () => db.query(`select period, ratings::int n, avg_rating::float avg from public.analytics_before_after(90)`))
    expect(ba.rows.map((x) => x.period)).toEqual(['before', 'after'])
    expect(ba.rows[0].n).toBeGreaterThanOrEqual(5)
    expect(ba.rows[1].avg).toBeGreaterThan(ba.rows[0].avg) // the seeded improvement shows up in the before/after view
  })
})
