import type { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, createDb, createTenant, type Tenant } from './helpers'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const IP = sha('some-visitor')

let db: PGlite
let a: Tenant
let b: Tenant
let aQuestions: { id: string; type: string; position: number }[]
let bQuestionId: string

const svc = <T>(fn: () => Promise<T>) => as(db, 'service_role', null, fn)

interface Submit {
  slug?: string
  token?: string
  star?: number | null
  message?: string | null
  answers?: unknown
  name?: string | null
  email?: string | null
  consent?: boolean | null
}
async function submit(o: Submit = {}) {
  const r = await svc(() =>
    db.query<{ r: { ok: boolean; error?: string; created?: boolean } }>(
      `select public.public_submit_feedback($1, $2, $3, $4, $5::jsonb, $6, $7, $8) as r`,
      [
        o.slug ?? a.slug,
        o.token ?? sha('visit-1'),
        o.star === undefined ? 4 : o.star,
        o.message ?? null,
        o.answers === undefined ? null : JSON.stringify(o.answers),
        o.name ?? null,
        o.email ?? null,
        o.consent ?? null,
      ],
    ),
  )
  return r.rows[0].r
}
const count = async (table: string, where = 'true') =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`)).rows[0].n

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
  const q = await db.query<{ id: string; type: string; position: number; business_id: string }>(
    `select id, type, position, business_id from public.survey_questions order by position`,
  )
  aQuestions = q.rows.filter((r) => r.business_id === a.businessId)
  bQuestionId = q.rows.find((r) => r.business_id === b.businessId)!.id
})

describe('permissions', () => {
  // a slug that doesn't exist, so the allowed (service-role) calls write nothing
  const calls = [
    `public.resolve_business_id('ghost-biz')`,
    `public.public_gate('ghost-biz', 'ev', '${IP}', 5)`,
    `public.public_track_event('ghost-biz', 'page_view', null)`,
    `public.public_submit_feedback('ghost-biz', '${sha('x')}', 5, null, null, null, null, null)`,
  ]
  it.each(calls)('%s is callable only by the service role', async (call) => {
    await expect(as(db, 'anon', null, () => db.query(`select ${call}`))).rejects.toThrow(/permission denied/)
    await expect(as(db, 'authenticated', a.userId, () => db.query(`select ${call}`))).rejects.toThrow(/permission denied/)
    await expect(svc(() => db.query(`select ${call}`))).resolves.toBeDefined()
  })
})

describe('public_gate', () => {
  const gate = (slug: string, ip = IP, limit = 3, bucket = 'ev') =>
    svc(() =>
      db.query<{ g: { found: boolean; allowed: boolean } }>(`select public.public_gate($1, $2, $3, $4) as g`, [slug, bucket, ip, limit]),
    ).then((r) => r.rows[0].g)

  it('reports unknown slugs without consuming a counter', async () => {
    const before = await count('rate_limits')
    expect(await gate('no-such-biz')).toEqual({ found: false, allowed: false })
    expect(await count('rate_limits')).toBe(before)
  })

  it('allows up to the limit, then blocks, per visitor and per business', async () => {
    const ip = sha('gate-visitor')
    expect((await gate(a.slug, ip)).allowed).toBe(true)
    expect((await gate(a.slug, ip)).allowed).toBe(true)
    expect((await gate(a.slug, ip)).allowed).toBe(true)
    expect((await gate(a.slug, ip)).allowed).toBe(false)
    expect((await gate(b.slug, ip)).allowed).toBe(true) // other business: own counter
    expect((await gate(a.slug, sha('another-visitor'))).allowed).toBe(true) // other visitor
  })

  it('keeps feedback and event counters separate', async () => {
    const ip = sha('bucket-visitor')
    for (let i = 0; i < 3; i++) await gate(a.slug, ip, 3, 'ev')
    expect((await gate(a.slug, ip, 3, 'ev')).allowed).toBe(false)
    expect((await gate(a.slug, ip, 3, 'fb')).allowed).toBe(true)
  })

  it('stores only the hash, never anything IP-like', async () => {
    const keys = (await db.query<{ key: string }>(`select key from public.rate_limits`)).rows.map((r) => r.key)
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(k).toMatch(/^(ev|fb|public|places):.*[0-9a-f]{64}$|^[a-z]+:/)
  })

  it('rejects a malformed hash or bucket', async () => {
    await expect(gate(a.slug, 'not-a-hash')).rejects.toThrow(/invalid gate/)
    await expect(gate(a.slug, IP, 3, 'zz')).rejects.toThrow(/invalid gate/)
  })

  it('counts an old slug against the same business', async () => {
    const t = await createTenant(db, 'Echo Eats', 'echo-eats')
    await as(db, 'authenticated', t.userId, () =>
      db.query(`update public.businesses set slug = 'echo-eatery' where id = $1`, [t.businessId]),
    )
    const ip = sha('rename-visitor')
    await gate('echo-eats', ip, 2)
    await gate('echo-eatery', ip, 2)
    expect((await gate('echo-eats', ip, 2)).allowed).toBe(false)
  })
})

describe('public_track_event', () => {
  const track = (slug: string, type: string, star: number | null) =>
    svc(() => db.query<{ r: boolean }>(`select public.public_track_event($1, $2, $3) as r`, [slug, type, star])).then((r) => r.rows[0].r)

  it('records page views, star clicks and Google link clicks for the right business', async () => {
    expect(await track(a.slug, 'page_view', null)).toBe(true)
    expect(await track(a.slug, 'star_click', 5)).toBe(true)
    expect(await track(a.slug, 'google_link_click', 5)).toBe(true)
    expect(await track(a.slug, 'google_link_click', null)).toBe(true)
    expect(await count('events', `business_id = '${a.businessId}'`)).toBe(4)
    expect(await count('events', `business_id = '${b.businessId}'`)).toBe(0)
  })

  it('returns false for unknown slugs and writes nothing', async () => {
    const before = await count('events')
    expect(await track('ghost-biz', 'page_view', null)).toBe(false)
    expect(await count('events')).toBe(before)
  })

  it('enforces star rules per event type', async () => {
    await expect(track(a.slug, 'star_click', null)).rejects.toThrow(/invalid star/)
    await expect(track(a.slug, 'page_view', 3)).rejects.toThrow(/invalid star/)
    await expect(track(a.slug, 'star_click', 6)).rejects.toThrow(/invalid star/)
    await expect(track(a.slug, 'star_click', 0)).rejects.toThrow(/invalid star/)
  })

  it('refuses event types a visitor must not be able to forge', async () => {
    await expect(track(a.slug, 'survey_completed', null)).rejects.toThrow(/not allowed/)
    await expect(track(a.slug, 'survey_started', null)).rejects.toThrow(/not allowed/)
  })

  it('follows old slugs', async () => {
    expect(await track('echo-eats', 'page_view', null)).toBe(true)
  })
})

describe('public_submit_feedback: one row per visit', () => {
  it('creates an empty row at the first star tap, then updates the SAME row', async () => {
    const t = sha('visit-flow')
    const first = await submit({ token: t, star: 5 })
    expect(first).toEqual({ ok: true, created: true })
    let rows = await db.query<{ id: string; star_rating: number; message: string | null; has_content: boolean; survey_answers: unknown[] }>(
      `select id, star_rating, message, has_content, survey_answers from public.feedback where business_id = $1 and star_rating = 5`,
      [a.businessId],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({ message: null, has_content: false, survey_answers: [] })
    const id = rows.rows[0].id

    // change rating
    expect(await submit({ token: t, star: 4 })).toEqual({ ok: true, created: false })
    // add text
    expect(await submit({ token: t, star: 4, message: '  Lovely staff  ' })).toEqual({ ok: true, created: false })

    rows = await db.query(`select id, star_rating, message, has_content, survey_answers from public.feedback where id = $1`, [id])
    expect(rows.rows[0]).toMatchObject({ star_rating: 4, message: 'Lovely staff', has_content: true })
    expect(await count('feedback', `id = '${id}'`)).toBe(1)
    expect(await count('feedback_secrets', `feedback_id = '${id}'`)).toBe(1)
  })

  it('lets the visitor clear their text again (full-state replace)', async () => {
    const t = sha('visit-clear')
    await submit({ token: t, star: 5, message: 'hi' })
    await submit({ token: t, star: 5, message: '   ' })
    const r = await db.query<{ message: string | null }>(
      `select f.message from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = $1`,
      [t],
    )
    expect(r.rows[0].message).toBeNull()
  })

  it('gives a different visit its own row and never touches the first', async () => {
    const t1 = sha('visit-iso-1')
    const t2 = sha('visit-iso-2')
    await submit({ token: t1, star: 5, message: 'visit one' })
    const before = await count('feedback')
    expect(await submit({ token: t2, star: 1, message: 'visit two' })).toEqual({ ok: true, created: true })
    expect(await count('feedback')).toBe(before + 1)
    const one = await db.query<{ star_rating: number; message: string }>(
      `select f.star_rating, f.message from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = $1`,
      [t1],
    )
    expect(one.rows[0]).toEqual({ star_rating: 5, message: 'visit one' })
  })

  it("won't let a token from one business edit anything on another business", async () => {
    const t = sha('visit-cross')
    await submit({ slug: a.slug, token: t, star: 5, message: 'for alpha' })
    const res = await submit({ slug: b.slug, token: t, star: 1, message: 'overwrite attempt' })
    expect(res).toEqual({ ok: false, error: 'invalid_token' })
    const r = await db.query<{ message: string; star_rating: number }>(
      `select f.message, f.star_rating from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = $1`,
      [t],
    )
    expect(r.rows[0]).toEqual({ message: 'for alpha', star_rating: 5 })
    expect(await count('feedback', `business_id = '${b.businessId}'`)).toBe(0)
  })

  it('stops edits after 24 hours', async () => {
    const t = sha('visit-old')
    await submit({ token: t, star: 3 })
    await db.query(`update public.feedback set created_at = now() - interval '25 hours' where id = (select feedback_id from public.feedback_secrets where token_hash = $1)`, [t])
    expect(await submit({ token: t, star: 5, message: 'late' })).toEqual({ ok: false, error: 'expired' })
  })

  it('stores only a hash of the visit token', async () => {
    const raw = 'raw-visit-token-abcdef'
    await submit({ token: sha(raw), star: 4 })
    const all = await db.query<{ token_hash: string }>(`select token_hash from public.feedback_secrets`)
    expect(all.rows.some((r) => r.token_hash === raw)).toBe(false)
    expect(all.rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true)
  })

  it('writes nothing and creates nothing for unknown slugs', async () => {
    const before = await count('feedback')
    expect(await submit({ slug: 'ghost-biz' })).toEqual({ ok: false, error: 'not_found' })
    expect(await count('feedback')).toBe(before)
  })

  it('works through an old slug', async () => {
    expect(await submit({ slug: 'echo-eats', token: sha('visit-old-slug'), star: 5 })).toMatchObject({ ok: true })
  })
})

describe('public_submit_feedback: validation (nothing is written on rejection)', () => {
  const rejected = async (o: Submit, error: string) => {
    const f = await count('feedback')
    const s = await count('feedback_secrets')
    const e = await count('events')
    expect(await submit({ token: sha(`rej-${Math.random()}`), ...o })).toEqual({ ok: false, error })
    expect([await count('feedback'), await count('feedback_secrets'), await count('events')]).toEqual([f, s, e])
  }

  it.each([0, 6, -1, null])('rejects star %s', async (star) => {
    await rejected({ star }, 'invalid_star')
  })

  it('rejects a malformed token hash', async () => {
    await rejected({ token: 'short' }, 'invalid_token')
  })

  it('rejects an oversize message but accepts exactly 2000 characters', async () => {
    await rejected({ message: 'x'.repeat(2001) }, 'invalid_message')
    expect(await submit({ token: sha('max-msg'), message: 'x'.repeat(2000) })).toMatchObject({ ok: true })
  })

  it('requires explicit consent for any contact detail', async () => {
    await rejected({ email: 'a@b.co' }, 'contact_requires_consent')
    await rejected({ name: 'Sam' }, 'contact_requires_consent')
    await rejected({ email: 'a@b.co', consent: false }, 'contact_requires_consent')
  })

  it('validates contact details when consent is given', async () => {
    await rejected({ email: 'not-an-email', consent: true }, 'invalid_contact')
    await rejected({ name: 'n'.repeat(121), consent: true }, 'invalid_contact')
    await rejected({ email: `${'a'.repeat(250)}@b.co`, consent: true }, 'invalid_contact')
    const t = sha('contact-ok')
    expect(await submit({ token: t, name: 'Sam', email: ' Sam@Example.COM ', consent: true })).toMatchObject({ ok: true })
    const r = await db.query<{ contact_email: string; contact_consent: boolean }>(
      `select f.contact_email, f.contact_consent from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = $1`,
      [t],
    )
    expect(r.rows[0]).toEqual({ contact_email: 'sam@example.com', contact_consent: true })
  })

  it('removes contact details again if the visitor withdraws consent', async () => {
    const t = sha('contact-withdraw')
    await submit({ token: t, name: 'Sam', email: 'sam@example.com', consent: true })
    await submit({ token: t })
    const r = await db.query<{ contact_email: string | null; contact_name: string | null }>(
      `select f.contact_email, f.contact_name from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = $1`,
      [t],
    )
    expect(r.rows[0]).toEqual({ contact_email: null, contact_name: null })
  })
})

describe('public_submit_feedback: survey answers', () => {
  const mc = () => aQuestions.find((q) => q.type === 'multiple_choice')!
  const lt = () => aQuestions.find((q) => q.type === 'long_text')!
  let ratingQ: string
  let requiredQ: string

  beforeAll(async () => {
    const survey = (await db.query<{ id: string }>(`select id from public.surveys where business_id = $1`, [a.businessId])).rows[0].id
    const r = await db.query<{ id: string }>(
      `insert into public.survey_questions (survey_id, business_id, position, type, prompt) values ($1, $2, 5, 'rating', 'How clean was it?') returning id`,
      [survey, a.businessId],
    )
    ratingQ = r.rows[0].id
    const req = await db.query<{ id: string }>(
      `insert into public.survey_questions (survey_id, business_id, position, type, prompt, required) values ($1, $2, 6, 'short_text', 'Your visit date?', true) returning id`,
      [survey, a.businessId],
    )
    requiredQ = req.rows[0].id
  })

  const bad = async (answers: unknown, label: string) => {
    const f = await count('feedback')
    expect(await submit({ token: sha(`bad-${label}`), star: 2, answers }), label).toEqual({ ok: false, error: 'invalid_answers' })
    expect(await count('feedback'), `${label}: row created`).toBe(f)
  }

  it('snapshots the question text next to each answer, in survey order', async () => {
    const t = sha('survey-ok')
    const res = await submit({
      token: t,
      star: 2,
      answers: [
        { question_id: requiredQ, answer: ' June 3 ' },
        { question_id: lt().id, answer: 'Waited 40 minutes' },
        { question_id: mc().id, answer: 'Wait time' },
        { question_id: ratingQ, answer: 3 },
      ],
    })
    expect(res).toMatchObject({ ok: true })
    const r = await db.query<{ survey_answers: { prompt: string; type: string; answer: unknown }[]; has_content: boolean }>(
      `select f.survey_answers, f.has_content from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = $1`,
      [t],
    )
    expect(r.rows[0].has_content).toBe(true)
    expect(r.rows[0].survey_answers.map((x) => x.answer)).toEqual(['Wait time', 'Waited 40 minutes', 3, 'June 3'])
    expect(r.rows[0].survey_answers[0].prompt).toMatch(/fell short/)
    expect(r.rows[0].survey_answers[0].type).toBe('multiple_choice')
  })

  it('keeps the old prompt text if the owner edits the question later', async () => {
    const t = sha('survey-snapshot')
    await submit({ token: t, star: 2, answers: [{ question_id: requiredQ, answer: 'today' }, { question_id: ratingQ, answer: 4 }] })
    await db.query(`update public.survey_questions set prompt = 'Totally different?' where id = $1`, [ratingQ])
    const r = await db.query<{ survey_answers: { prompt: string }[] }>(
      `select f.survey_answers from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = $1`,
      [t],
    )
    expect(r.rows[0].survey_answers.map((x) => x.prompt)).toContain('How clean was it?')
    await db.query(`update public.survey_questions set prompt = 'How clean was it?' where id = $1`, [ratingQ])
  })

  it("rejects another business's question id, unknown ids, duplicates and malformed entries", async () => {
    await bad([{ question_id: bQuestionId, answer: 'x' }, { question_id: requiredQ, answer: 'x' }], 'other-biz')
    await bad([{ question_id: '00000000-0000-0000-0000-000000000000', answer: 'x' }], 'unknown')
    await bad([{ question_id: 'nope', answer: 'x' }], 'not-uuid')
    await bad([{ question_id: lt().id, answer: 'a' }, { question_id: lt().id, answer: 'b' }], 'dupe')
    await bad(['string'], 'not-object')
    await bad({ question_id: lt().id }, 'not-array')
  })

  it('rejects more than 20 answers', async () => {
    await bad(Array.from({ length: 21 }, () => ({ question_id: lt().id, answer: 'x' })), 'too-many')
  })

  it('checks each answer against its question type', async () => {
    await bad([{ question_id: mc().id, answer: 'Not an option' }, { question_id: requiredQ, answer: 'x' }], 'mc-option')
    await bad([{ question_id: mc().id, answer: 42 }, { question_id: requiredQ, answer: 'x' }], 'mc-type')
    await bad([{ question_id: ratingQ, answer: 6 }, { question_id: requiredQ, answer: 'x' }], 'rating-high')
    await bad([{ question_id: ratingQ, answer: 2.5 }, { question_id: requiredQ, answer: 'x' }], 'rating-frac')
    await bad([{ question_id: ratingQ, answer: '3' }, { question_id: requiredQ, answer: 'x' }], 'rating-string')
    await bad([{ question_id: requiredQ, answer: 'y'.repeat(301) }], 'short-too-long')
    await bad([{ question_id: lt().id, answer: 'z'.repeat(2001) }, { question_id: requiredQ, answer: 'x' }], 'long-too-long')
    await bad([{ question_id: requiredQ, answer: { nested: true } }], 'object-answer')
  })

  it('enforces required questions once any answer is given', async () => {
    await bad([{ question_id: lt().id, answer: 'text only' }], 'required-missing')
    await bad([{ question_id: requiredQ, answer: '   ' }], 'required-blank')
  })

  it('accepts an empty survey, since the survey is optional', async () => {
    expect(await submit({ token: sha('no-survey'), star: 1, answers: [] })).toMatchObject({ ok: true })
  })

  it('rejects answers when the survey is switched off', async () => {
    await db.query(`update public.surveys set enabled = false where business_id = $1`, [a.businessId])
    await bad([{ question_id: requiredQ, answer: 'x' }], 'disabled')
    await db.query(`update public.surveys set enabled = true where business_id = $1`, [a.businessId])
  })

  it('logs survey_completed once per visit, not on every edit', async () => {
    const t = sha('survey-event')
    const before = await count('events', `type = 'survey_completed' and business_id = '${a.businessId}'`)
    const answers = [{ question_id: requiredQ, answer: 'today' }]
    await submit({ token: t, star: 2, answers })
    await submit({ token: t, star: 1, answers })
    await submit({ token: t, star: 1, answers: [{ question_id: requiredQ, answer: 'edited' }] })
    expect(await count('events', `type = 'survey_completed' and business_id = '${a.businessId}'`)).toBe(before + 1)
  })
})

describe('visit token storage rules', () => {
  it('rejects a duplicate token hash and a malformed one, even from the service role', async () => {
    const fb = await svc(() =>
      db.query<{ id: string }>(`insert into public.feedback (business_id, star_rating) values ($1, 3), ($1, 4) returning id`, [a.businessId]),
    )
    const h = sha('unique-check')
    await svc(() => db.query(`insert into public.feedback_secrets (feedback_id, token_hash) values ($1, $2)`, [fb.rows[0].id, h]))
    await expect(svc(() => db.query(`insert into public.feedback_secrets (feedback_id, token_hash) values ($1, $2)`, [fb.rows[1].id, h]))).rejects.toThrow(/duplicate key/)
    await expect(svc(() => db.query(`insert into public.feedback_secrets (feedback_id, token_hash) values ($1, 'visit-token-in-the-clear')`, [fb.rows[1].id]))).rejects.toThrow(/check constraint/)
  })
})

describe('qr_downloaded_at (onboarding step 4)', () => {
  it('lets an owner mark their own QR as downloaded', async () => {
    const r = await as(db, 'authenticated', a.userId, () =>
      db.query(`update public.businesses set qr_downloaded_at = now() where id = $1 returning qr_downloaded_at`, [a.businessId]),
    )
    expect(r.rows).toHaveLength(1)
  })

  it("cannot touch another business's flag", async () => {
    const r = await as(db, 'authenticated', a.userId, () =>
      db.query(`update public.businesses set qr_downloaded_at = now() where id = $1 returning id`, [b.businessId]),
    )
    expect(r.rows).toHaveLength(0)
  })
})
