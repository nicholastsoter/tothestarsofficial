import type { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, createDb, createTenant, type Tenant } from './helpers'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

let db: PGlite
let a: Tenant
let b: Tenant
let aSurvey: string
let bSurvey: string

const asA = <T>(fn: () => Promise<T>) => as(db, 'authenticated', a.userId, fn)
const asB = <T>(fn: () => Promise<T>) => as(db, 'authenticated', b.userId, fn)
const svc = <T>(fn: () => Promise<T>) => as(db, 'service_role', null, fn)

interface Row { id: string; star_rating: number; message: string | null; status: string; total_count: string | number; created_at: Date }

/** Insert a feedback row directly (superuser), the way the submit function would have left it. */
async function fb(
  biz: Tenant,
  o: { star?: number; message?: string | null; answers?: unknown[]; status?: 'new' | 'resolved'; at?: string; name?: string; email?: string } = {},
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.feedback (business_id, star_rating, message, survey_answers, status, created_at, contact_name, contact_email, contact_consent)
     values ($1, $2, $3, $4::jsonb, $5, coalesce($6::timestamptz, now()), $7, $8, $9) returning id`,
    [biz.businessId, o.star ?? 3, o.message ?? null, JSON.stringify(o.answers ?? []), o.status ?? 'new', o.at ?? null, o.name ?? null, o.email ?? null, Boolean(o.name || o.email)],
  )
  return r.rows[0].id
}
const inbox = (user: 'a' | 'b', args: Record<string, unknown> = {}) => {
  const keys = Object.keys(args)
  const sql = `select * from public.inbox_feedback(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`
  return (user === 'a' ? asA : asB)(() => db.query<Row>(sql, keys.map((k) => args[k])))
}
const questionIds = async (biz: Tenant) =>
  (await db.query<{ id: string }>(`select id from public.survey_questions where business_id = $1 order by position`, [biz.businessId])).rows.map((r) => r.id)
const addQuestion = (survey: string, biz: Tenant, position: number, type = 'short_text', options: unknown = null, prompt = 'Q?') =>
  asA(() =>
    db.query(`insert into public.survey_questions (survey_id, business_id, position, type, prompt, options) values ($1, $2, $3, $4, $5, $6::jsonb)`, [
      survey, biz.businessId, position, type, prompt, options === null ? null : JSON.stringify(options),
    ]),
  )

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
  const s = await db.query<{ id: string; business_id: string }>(`select id, business_id from public.surveys`)
  aSurvey = s.rows.find((r) => r.business_id === a.businessId)!.id
  bSurvey = s.rows.find((r) => r.business_id === b.businessId)!.id
})

describe('function permissions', () => {
  it('lets only logged-in owners call the inbox/survey helpers, and only the service role call the alert functions', async () => {
    const owner = [`public.new_feedback_count()`, `public.inbox_feedback()`]
    for (const call of owner) {
      await expect(as(db, 'anon', null, () => db.query(`select * from ${call}`))).rejects.toThrow(/permission denied/)
      await expect(asA(() => db.query(`select * from ${call}`))).resolves.toBeDefined()
    }
    await expect(as(db, 'anon', null, () => db.query(`select public.reorder_survey_questions($1, '{}')`, [aSurvey]))).rejects.toThrow(/permission denied/)

    const internal = [`public.claim_low_rating_alert('alpha-cafe', '${sha('x')}')`, `public.release_alert(gen_random_uuid())`]
    for (const call of internal) {
      await expect(as(db, 'anon', null, () => db.query(`select ${call}`))).rejects.toThrow(/permission denied/)
      await expect(asA(() => db.query(`select ${call}`))).rejects.toThrow(/permission denied/)
      await expect(svc(() => db.query(`select ${call}`))).resolves.toBeDefined()
    }
  })
})

describe('survey question rules', () => {
  it('allows 10 questions per survey and refuses the 11th', async () => {
    for (let i = 2; i < 10; i++) await addQuestion(aSurvey, a, i, 'short_text', null, `Extra ${i}`)
    expect((await questionIds(a)).length).toBe(10)
    await expect(addQuestion(aSurvey, a, 10)).rejects.toThrow(/at most 10 questions/)
  })

  it('counts per survey, not across businesses', async () => {
    await expect(
      asB(() => db.query(`insert into public.survey_questions (survey_id, business_id, position, type, prompt) values ($1, $2, 7, 'short_text', 'Mine')`, [bSurvey, b.businessId])),
    ).resolves.toBeDefined()
  })

  it('frees a slot when a question is deleted', async () => {
    const ids = await questionIds(a)
    await asA(() => db.query(`delete from public.survey_questions where id = $1`, [ids[9]]))
    await expect(addQuestion(aSurvey, a, 20)).resolves.toBeDefined()
    // restore to a known-size survey for later tests
    const all = await questionIds(a)
    await asA(() => db.query(`delete from public.survey_questions where id = any($1::uuid[]) and position >= 4`, [all]))
  })

  it.each([
    ['a non-string option', [1, 'b'], /1-100 characters/],
    ['an empty option', ['a', ''], /1-100 characters/],
    ['a blank option', ['a', '   '], /1-100 characters/],
    ['an over-long option', ['a', 'x'.repeat(101)], /1-100 characters/],
    ['duplicate options', ['a', 'a'], /all be different/],
    ['an object option', ['a', { x: 1 }], /1-100 characters/],
  ])('rejects %s in multiple choice', async (_label, options, error) => {
    await expect(addQuestion(aSurvey, a, 30, 'multiple_choice', options)).rejects.toThrow(error)
  })

  it('accepts a valid multiple-choice question and applies the same rules on edit', async () => {
    await addQuestion(aSurvey, a, 31, 'multiple_choice', ['Fast', 'Friendly'], 'What was good?')
    const id = (await db.query<{ id: string }>(`select id from public.survey_questions where prompt = 'What was good?'`)).rows[0].id
    await expect(asA(() => db.query(`update public.survey_questions set options = '["x", ""]'::jsonb where id = $1`, [id]))).rejects.toThrow(/1-100 characters/)
    await expect(asA(() => db.query(`update public.survey_questions set options = '["x", "y", "z"]'::jsonb where id = $1`, [id]))).resolves.toBeDefined()
  })
})

describe('reordering', () => {
  it('reverses a whole survey in one call without breaking the unique position rule', async () => {
    const before = await questionIds(a)
    expect(before.length).toBeGreaterThanOrEqual(3)
    const reversed = [...before].reverse()
    await asA(() => db.query(`select public.reorder_survey_questions($1, $2::uuid[])`, [aSurvey, `{${reversed.join(',')}}`]))
    expect(await questionIds(a)).toEqual(reversed)
    const positions = (await db.query<{ position: number }>(`select position from public.survey_questions where survey_id = $1 order by position`, [aSurvey])).rows.map((r) => r.position)
    expect(positions).toEqual(positions.map((_, i) => i)) // 0..n-1, gaps closed
  })

  it('rejects a list that is missing, extra or duplicated, and changes nothing', async () => {
    const ids = await questionIds(a)
    const bad = [ids.slice(1), [...ids, ids[0]], [ids[0], ...ids.slice(0, -1)], [...ids.slice(0, -1), 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0']]
    for (const list of bad) {
      await expect(asA(() => db.query(`select public.reorder_survey_questions($1, $2::uuid[])`, [aSurvey, `{${list.join(',')}}`]))).rejects.toThrow(/does not match/)
    }
    expect(await questionIds(a)).toEqual(ids)
  })

  it("can't reorder someone else's survey, even with the right ids", async () => {
    const bIds = await questionIds(b)
    await expect(asA(() => db.query(`select public.reorder_survey_questions($1, $2::uuid[])`, [bSurvey, `{${[...bIds].reverse().join(',')}}`]))).rejects.toThrow(/does not match/)
    expect(await questionIds(b)).toEqual(bIds)
  })
})

describe('inbox: isolation and has_content', () => {
  beforeAll(async () => {
    await fb(a, { star: 5 }) // bare star tap
    await fb(a, { star: 4, message: 'Loved the pasta' })
    await fb(b, { star: 1, message: 'B private complaint' })
  })

  it("shows an owner only their own feedback and never another business's", async () => {
    const mine = await inbox('a')
    expect(mine.rows.every((r) => r.message !== 'B private complaint')).toBe(true)
    expect(mine.rows.some((r) => r.message === 'Loved the pasta')).toBe(true)
    const theirs = await inbox('b')
    expect(theirs.rows.map((r) => r.message)).toEqual(['B private complaint'])
  })

  it('leaves out ratings with no text and no answers', async () => {
    expect((await inbox('a')).rows.every((r) => r.star_rating !== 5)).toBe(true)
  })

  it('searching for the other business\'s text finds nothing', async () => {
    expect((await inbox('a', { p_search: 'private complaint' })).rows).toHaveLength(0)
  })
})

describe('inbox: filters, search, sort and pages', () => {
  let c: Tenant
  const cInbox = (args: Record<string, unknown> = {}) => {
    const keys = Object.keys(args)
    return as(db, 'authenticated', c.userId, () => db.query<Row>(`select * from public.inbox_feedback(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map((k) => args[k])))
  }

  beforeAll(async () => {
    c = await createTenant(db, 'Charlie Cuts', 'charlie-cuts')
    await db.query(`update public.businesses set timezone = 'Pacific/Auckland' where id = $1`, [c.businessId])
    const sv = (p: string, answer: string) => [{ question_id: 'x', prompt: p, type: 'short_text', answer }]
    await fb(c, { star: 1, message: 'Terrible wait', at: '2026-03-01T10:00:00Z' })
    await fb(c, { star: 2, message: 'Cold food. 100% disappointed', at: '2026-03-02T10:00:00Z', status: 'resolved' })
    await fb(c, { star: 3, answers: sv('What went wrong?', 'The a_b sauce'), at: '2026-03-03T10:00:00Z' })
    await fb(c, { star: 4, message: 'Pretty good', at: '2026-03-04T10:00:00Z', name: 'Sam Rivera', email: 'sam@example.com' })
    await fb(c, { star: 5, message: 'Perfect', at: '2026-03-05T10:00:00Z', status: 'resolved' })
  })

  it('defaults to newest first', async () => {
    expect((await cInbox()).rows.map((r) => r.star_rating)).toEqual([5, 4, 3, 2, 1])
  })

  it('sorts oldest, highest stars, lowest stars', async () => {
    expect((await cInbox({ p_sort: 'oldest' })).rows.map((r) => r.star_rating)).toEqual([1, 2, 3, 4, 5])
    expect((await cInbox({ p_sort: 'stars_high' })).rows.map((r) => r.star_rating)).toEqual([5, 4, 3, 2, 1])
    expect((await cInbox({ p_sort: 'stars_low' })).rows.map((r) => r.star_rating)).toEqual([1, 2, 3, 4, 5])
    expect((await cInbox({ p_sort: 'drop table feedback' })).rows).toHaveLength(5) // unknown sort falls back to newest
  })

  it('filters by status and by star range', async () => {
    expect((await cInbox({ p_status: 'resolved' })).rows.map((r) => r.star_rating)).toEqual([5, 2])
    expect((await cInbox({ p_status: 'new' })).rows.map((r) => r.star_rating)).toEqual([4, 3, 1])
    expect((await cInbox({ p_min_star: 2, p_max_star: 3 })).rows.map((r) => r.star_rating)).toEqual([3, 2])
    expect((await cInbox({ p_min_star: 5, p_max_star: 1 })).rows).toHaveLength(0)
  })

  it("applies date ranges in the business's own time zone", async () => {
    // 2026-03-03 10:00Z is 23:00 on 3 March in Auckland (UTC+13); 2026-03-04 10:00Z is 23:00 on 4 March.
    expect((await cInbox({ p_from: '2026-03-03', p_to: '2026-03-03' })).rows.map((r) => r.star_rating)).toEqual([3])
    expect((await cInbox({ p_from: '2026-03-04' })).rows.map((r) => r.star_rating)).toEqual([5, 4])
    expect((await cInbox({ p_to: '2026-03-02' })).rows.map((r) => r.star_rating)).toEqual([2, 1])
    // 01:00 on 2 March in Auckland is 12:00Z on 1 March: a UTC date filter would have put this in March 1
    await fb(c, { star: 2, message: 'Edge of day', at: '2026-03-01T12:30:00Z' })
    expect((await cInbox({ p_from: '2026-03-02', p_to: '2026-03-02', p_search: 'Edge of day' })).rows).toHaveLength(1)
    expect((await cInbox({ p_from: '2026-03-01', p_to: '2026-03-01', p_search: 'Edge of day' })).rows).toHaveLength(0)
  })

  it('searches messages, survey questions and answers, and opted-in contact details (case-insensitive)', async () => {
    expect((await cInbox({ p_search: 'COLD food' })).rows.map((r) => r.star_rating)).toEqual([2])
    expect((await cInbox({ p_search: 'what went wrong' })).rows.map((r) => r.star_rating)).toEqual([3])
    expect((await cInbox({ p_search: 'sauce' })).rows.map((r) => r.star_rating)).toEqual([3])
    expect((await cInbox({ p_search: 'rivera' })).rows.map((r) => r.star_rating)).toEqual([4])
    expect((await cInbox({ p_search: 'sam@example' })).rows.map((r) => r.star_rating)).toEqual([4])
    expect((await cInbox({ p_search: 'nothing like this' })).rows).toHaveLength(0)
  })

  it('treats % and _ in a search as plain characters, not wildcards', async () => {
    expect((await cInbox({ p_search: '100%' })).rows.map((r) => r.star_rating)).toEqual([2])
    expect((await cInbox({ p_search: '%' })).rows.map((r) => r.star_rating)).toEqual([2]) // only the message that contains a literal %
    expect((await cInbox({ p_search: 'a_b' })).rows.map((r) => r.star_rating)).toEqual([3])
    expect((await cInbox({ p_search: 'a_c' })).rows).toHaveLength(0)
    expect((await cInbox({ p_search: '\\' })).rows).toHaveLength(0)
  })

  it('does not match JSON field names when searching survey answers', async () => {
    expect((await cInbox({ p_search: 'question_id' })).rows).toHaveLength(0)
  })

  it('paginates with a stable total', async () => {
    const p1 = await cInbox({ p_limit: 2, p_offset: 0 })
    const p2 = await cInbox({ p_limit: 2, p_offset: 2 })
    const p3 = await cInbox({ p_limit: 2, p_offset: 4 })
    expect([p1.rows.length, p2.rows.length, p3.rows.length]).toEqual([2, 2, 2])
    expect(new Set([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id)).size).toBe(6)
    expect(Number(p1.rows[0].total_count)).toBe(6)
    expect((await cInbox({ p_limit: 2, p_offset: 100 })).rows).toHaveLength(0)
  })

  it('caps page size at 500 and tolerates silly values', async () => {
    expect((await cInbox({ p_limit: 100000 })).rows.length).toBe(6)
    expect((await cInbox({ p_limit: -5, p_offset: -9 })).rows.length).toBe(1)
  })

  it('can show only survey responses (answers present)', async () => {
    expect((await cInbox({ p_only_surveys: true })).rows.map((r) => r.star_rating)).toEqual([3])
  })

  it('counts only new items with content, per owner', async () => {
    const n = (user: Tenant) => as(db, 'authenticated', user.userId, async () => Number((await db.query<{ n: string }>(`select public.new_feedback_count() as n`)).rows[0].n))
    expect(await n(c)).toBe(4) // 1, 3, 4 and the edge-of-day item; resolved ones and bare taps excluded
    expect(await n(b)).toBe(1)
  })
})

describe('owners still can only triage', () => {
  it('cannot edit ratings/messages or touch the alert marker, but can resolve and annotate', async () => {
    const id = await fb(a, { star: 2, message: 'edit-lock check' })
    for (const set of ['star_rating = 5', "message = 'x'", 'alert_sent_at = now()', 'alert_sent_at = null']) {
      await expect(asA(() => db.query(`update public.feedback set ${set} where id = $1`, [id])), set).rejects.toThrow(/permission denied/)
    }
    const ok = await asA(() => db.query(`update public.feedback set status = 'resolved', private_note = 'called' where id = $1 returning status`, [id]))
    expect(ok.rows[0]).toEqual({ status: 'resolved' })
  })

  it("can delete their own feedback but not another business's", async () => {
    const mine = await fb(a, { star: 1, message: 'to delete' })
    const theirs = await fb(b, { star: 1, message: 'not yours' })
    expect((await asA(() => db.query(`delete from public.feedback where id = $1 returning id`, [mine]))).rows).toHaveLength(1)
    expect((await asA(() => db.query(`delete from public.feedback where id = $1 returning id`, [theirs]))).rows).toHaveLength(0)
  })
})

describe('claim_low_rating_alert', () => {
  let d: Tenant
  const submit = (token: string, star: number, message: string | null, answers: unknown[] = []) =>
    svc(() =>
      db.query(`select public.public_submit_feedback($1, $2, $3, $4, $5::jsonb, null, null, null)`, [d.slug, sha(token), star, message, JSON.stringify(answers)]),
    )
  const claim = async (token: string, slug = 'dee-diner') =>
    (await svc(() => db.query<{ c: Record<string, unknown> | null }>(`select public.claim_low_rating_alert($1, $2) as c`, [slug, sha(token)]))).rows[0].c

  beforeAll(async () => {
    d = await createTenant(db, 'Dee Diner', 'dee-diner')
  })

  it('claims once for a 1-3 star item with content, and never twice', async () => {
    await submit('t-once', 2, 'Cold soup')
    const first = await claim('t-once')
    expect(first).toMatchObject({ star_rating: 2, message: 'Cold soup', business_name: 'Dee Diner', to_email: 'dee-diner@example.com' })
    expect(await claim('t-once')).toBeNull()
    await submit('t-once', 1, 'Cold soup and rude') // the customer edits the same row
    expect(await claim('t-once')).toBeNull()
  })

  it('includes the snapshotted question text and answers', async () => {
    const q = (await db.query<{ id: string }>(`select id from public.survey_questions where business_id = $1 and type = 'long_text'`, [d.businessId])).rows[0].id
    await submit('t-answers', 3, null, [{ question_id: q, answer: 'Waited an hour' }])
    const c = await claim('t-answers')
    expect(c?.answers).toEqual([{ prompt: 'Tell us more about what happened.', answer: 'Waited an hour' }])
  })

  it('never includes contact details', async () => {
    await svc(() =>
      db.query(`select public.public_submit_feedback($1, $2, 2, 'Slow', null, 'Sam Rivera', 'sam@example.com', true)`, [d.slug, sha('t-contact')]),
    )
    const c = await claim('t-contact')
    expect(Object.keys(c!).sort()).toEqual(['answers', 'business_name', 'created_at', 'feedback_id', 'message', 'star_rating', 'to_email'])
    expect(JSON.stringify(c)).not.toMatch(/Rivera|sam@example/)
  })

  it('does not alert on a bare star tap, and alerts once text arrives', async () => {
    await submit('t-bare', 1, null)
    expect(await claim('t-bare')).toBeNull()
    await submit('t-bare', 1, 'Now with words')
    expect(await claim('t-bare')).not.toBeNull()
  })

  it('does not alert on 4 or 5 stars', async () => {
    await submit('t-four', 4, 'Pretty good')
    await submit('t-five', 5, 'Perfect')
    expect(await claim('t-four')).toBeNull()
    expect(await claim('t-five')).toBeNull()
  })

  it('does not alert when the owner switched alerts off', async () => {
    await db.query(`update public.businesses set alerts_enabled = false where id = $1`, [d.businessId])
    await submit('t-off', 1, 'Awful')
    expect(await claim('t-off')).toBeNull()
    await db.query(`update public.businesses set alerts_enabled = true where id = $1`, [d.businessId])
    expect(await claim('t-off')).not.toBeNull() // still unclaimed, so it goes out once alerts are back on
  })

  it("won't claim with another business's slug or an unknown token", async () => {
    await submit('t-cross', 1, 'Terrible')
    expect(await claim('t-cross', 'alpha-cafe')).toBeNull()
    expect(await claim('never-seen')).toBeNull()
    expect(await claim('t-cross')).not.toBeNull()
  })

  it('limits a business to 10 alerts per hour, and a blocked item can still alert later', async () => {
    const e = await createTenant(db, 'Eve Eats', 'eve-eats')
    const send = (t: string) => svc(() => db.query(`select public.public_submit_feedback('eve-eats', $1, 1, 'bad', null, null, null, null)`, [sha(t)]))
    const results: boolean[] = []
    for (let i = 0; i < 12; i++) {
      await send(`flood-${i}`)
      results.push((await claim(`flood-${i}`, 'eve-eats')) !== null)
    }
    expect(results.filter(Boolean)).toHaveLength(10)
    expect(results.slice(10)).toEqual([false, false])
    // a different business is unaffected
    expect(await claim('t-never', 'dee-diner')).toBeNull()
    void e
  })

  it('hands a claim back if the email fails, so a later edit can retry', async () => {
    await submit('t-release', 2, 'Hmm')
    const c = await claim('t-release')
    expect(await claim('t-release')).toBeNull()
    await svc(() => db.query(`select public.release_alert($1)`, [c!.feedback_id]))
    expect(await claim('t-release')).not.toBeNull()
  })
})

describe('survey edits versus old responses', () => {
  let f: Tenant
  let q1: string
  let q2: string
  const answerFor = (token: string, answers: unknown[], star = 2) =>
    svc(() => db.query<{ r: { ok: boolean; error?: string } }>(`select public.public_submit_feedback($1, $2, $3, null, $4::jsonb, null, null, null) as r`, [f.slug, sha(token), star, JSON.stringify(answers)])).then((x) => x.rows[0].r)
  const stored = async (token: string) =>
    (await db.query<{ survey_answers: { prompt: string; answer: string }[] }>(`select f.survey_answers from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = $1`, [sha(token)])).rows[0].survey_answers

  beforeAll(async () => {
    f = await createTenant(db, 'Fox Foods', 'fox-foods')
    ;[q1, q2] = await questionIds(f)
    await answerFor('old-visit', [{ question_id: q1, answer: 'Wait time' }, { question_id: q2, answer: 'Slow kitchen' }])
  })

  it('keeps old responses readable after a question is edited, reordered or deleted', async () => {
    const before = await stored('old-visit')
    expect(before.map((x) => x.prompt)).toEqual(['What fell short of your expectations?', 'Tell us more about what happened.'])

    await as(db, 'authenticated', f.userId, () => db.query(`update public.survey_questions set prompt = 'Completely different question?' where id = $1`, [q1]))
    await as(db, 'authenticated', f.userId, () => db.query(`select public.reorder_survey_questions((select survey_id from public.survey_questions where id = $1), $2::uuid[])`, [q1, `{${q2},${q1}}`]))
    await as(db, 'authenticated', f.userId, () => db.query(`delete from public.survey_questions where id = $1`, [q1]))

    expect(await stored('old-visit')).toEqual(before) // snapshot untouched
    const row = await db.query<{ has_content: boolean }>(`select f.has_content from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = $1`, [sha('old-visit')])
    expect(row.rows[0].has_content).toBe(true)
  })

  it('rejects an in-flight visit that answers a question that has since been deleted, writing nothing', async () => {
    const rowsBefore = (await db.query<{ n: number }>(`select count(*)::int as n from public.feedback where business_id = $1`, [f.businessId])).rows[0].n
    const r = await answerFor('in-flight', [{ question_id: q1, answer: 'Service' }, { question_id: q2, answer: 'still here' }])
    expect(r).toEqual({ ok: false, error: 'invalid_answers' })
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.feedback where business_id = $1`, [f.businessId])).rows[0].n).toBe(rowsBefore)
  })

  it('accepts the same visit once the stale answer is dropped', async () => {
    expect(await answerFor('in-flight', [{ question_id: q2, answer: 'still here' }])).toMatchObject({ ok: true })
  })

  it('snapshots the CURRENT wording when a question was edited before the customer answered', async () => {
    await as(db, 'authenticated', f.userId, () => db.query(`update public.survey_questions set prompt = 'Edited wording' where id = $1`, [q2]))
    await answerFor('after-edit', [{ question_id: q2, answer: 'fresh' }])
    expect((await stored('after-edit'))[0].prompt).toBe('Edited wording')
    expect((await stored('old-visit')).map((x) => x.prompt)).toContain('Tell us more about what happened.') // old one unchanged
  })

  it('serves the edited survey on the public page immediately', async () => {
    const r = await as(db, 'anon', null, () => db.query<{ p: { questions: { prompt: string }[] } }>(`select public.get_public_review_page('fox-foods') as p`))
    expect(r.rows[0].p.questions.map((x) => x.prompt)).toEqual(['Edited wording'])
  })
})

describe('account deletion covers the new data', () => {
  it('removes feedback (including alert markers) with the account', async () => {
    const g = await createTenant(db, 'Gus Grill', 'gus-grill')
    await svc(() => db.query(`select public.public_submit_feedback('gus-grill', $1, 1, 'bad', null, null, null, null)`, [sha('gus')]))
    await svc(() => db.query(`select public.claim_low_rating_alert('gus-grill', $1)`, [sha('gus')]))
    await db.query(`delete from auth.users where id = $1`, [g.userId])
    for (const t of ['feedback', 'survey_questions', 'surveys', 'events']) {
      expect((await db.query(`select 1 from public.${t} where business_id = $1`, [g.businessId])).rows, t).toHaveLength(0)
    }
    expect((await db.query(`select 1 from public.rate_limits where key like $1`, [`alert:${g.businessId}%`])).rows.length).toBeLessThanOrEqual(1) // counters hold only an id, no content
  })
})
