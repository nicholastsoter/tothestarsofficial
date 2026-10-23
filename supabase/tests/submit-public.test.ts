import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createSubmitPublicHandler, type SubmitPublicDeps } from '../functions/submit-public/handler'
import { createDb, createTenant, dbContains, pgRpc, type Tenant } from './helpers'

let db: PGlite
let a: Tenant
let b: Tenant
let turnstileCalls = 0

const TOKEN = (n: string) => `visit-${n}`.padEnd(24, 'x') // 24 chars, url-safe
const baseDeps = (): SubmitPublicDeps => ({
  rpc: pgRpc(db),
  verifyTurnstile: async (t) => {
    turnstileCalls++
    return t === 'good-turnstile'
  },
  ipHashSecret: 'unit-test-secret',
})

async function call(body: unknown, opts: { deps?: Partial<SubmitPublicDeps>; ip?: string; method?: string; raw?: string } = {}) {
  const handler = createSubmitPublicHandler({ ...baseDeps(), ...opts.deps })
  const req = new Request('https://example.test/functions/v1/submit-public', {
    method: opts.method ?? 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': opts.ip ?? '198.51.100.23' },
    body: opts.method === 'GET' ? undefined : (opts.raw ?? JSON.stringify(body)),
  })
  const res = await handler(req)
  const text = await res.text()
  return { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : null }
}

const feedback = (extra: Record<string, unknown> = {}) => ({
  action: 'submit_feedback',
  slug: a.slug,
  visit_token: TOKEN('default'),
  star: 5,
  turnstile_token: 'good-turnstile',
  ...extra,
})
const count = async (table: string, where = 'true') =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`)).rows[0].n

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
})

describe('HTTP basics', () => {
  it('answers CORS preflight and rejects other methods', async () => {
    expect((await call(null, { method: 'OPTIONS' })).status).toBe(204)
    expect((await call(null, { method: 'GET' })).status).toBe(405)
  })

  it('rejects non-JSON, non-object, unknown actions and bad slugs', async () => {
    expect((await call(null, { raw: 'not json' })).json).toEqual({ error: 'invalid_json' })
    expect((await call([1, 2])).json).toEqual({ error: 'invalid_request' })
    expect((await call({ action: 'delete_everything', slug: a.slug })).json).toEqual({ error: 'invalid_action' })
    expect((await call({ action: 'page_view', slug: 'bad slug!' })).json).toEqual({ error: 'invalid_slug' })
    expect((await call({ action: 'page_view' })).json).toEqual({ error: 'invalid_slug' })
  })

  it('refuses oversize bodies before doing any work', async () => {
    const r = await call(feedback({ message: 'x'.repeat(25_000) }))
    expect(r.status).toBe(413)
    expect(await count('feedback')).toBe(0)
  })
})

describe('events (rate limit only, no Turnstile)', () => {
  it('records page_view, star_click and google_link_click without a captcha', async () => {
    turnstileCalls = 0
    expect((await call({ action: 'page_view', slug: a.slug })).json).toEqual({ ok: true })
    expect((await call({ action: 'star_click', slug: a.slug, star: 4 })).json).toEqual({ ok: true })
    expect((await call({ action: 'google_link_click', slug: a.slug, star: 4 })).json).toEqual({ ok: true })
    expect(await count('events', `business_id = '${a.businessId}'`)).toBe(3)
    expect(turnstileCalls).toBe(0)
  })

  it('validates stars per event type', async () => {
    for (const body of [
      { action: 'star_click', slug: a.slug },
      { action: 'star_click', slug: a.slug, star: 6 },
      { action: 'star_click', slug: a.slug, star: 'five' },
      { action: 'star_click', slug: a.slug, star: 2.5 },
      { action: 'page_view', slug: a.slug, star: 3 },
    ]) {
      const r = await call(body)
      expect(r.status, JSON.stringify(body)).toBe(400)
      expect(r.json).toEqual({ error: 'invalid_star' })
    }
  })

  it('cannot be used to forge survey_completed', async () => {
    expect((await call({ action: 'survey_completed', slug: a.slug })).status).toBe(400)
  })

  it('returns 404 for unknown slugs and consumes no rate-limit counter', async () => {
    const before = await count('rate_limits')
    expect((await call({ action: 'page_view', slug: 'ghost-biz' })).json).toEqual({ error: 'not_found' })
    expect(await count('rate_limits')).toBe(before)
  })

  it('rate-limits events per visitor per business, with a separate and larger allowance', async () => {
    const deps = { eventsPerHour: 3 }
    const ip = '203.0.113.50'
    for (let i = 0; i < 3; i++) expect((await call({ action: 'page_view', slug: a.slug }, { deps, ip })).status).toBe(200)
    const blocked = await call({ action: 'page_view', slug: a.slug }, { deps, ip })
    expect(blocked.status).toBe(429)
    expect(blocked.json).toEqual({ error: 'rate_limited' })
    expect(blocked.headers.get('retry-after')).toBe('3600')
    expect((await call({ action: 'page_view', slug: b.slug }, { deps, ip })).status).toBe(200) // other business
    expect((await call({ action: 'page_view', slug: a.slug }, { deps, ip: '203.0.113.51' })).status).toBe(200) // other visitor
    expect((await call(feedback({ visit_token: TOKEN('events-vs-fb') }), { ip })).status).toBe(200) // feedback has its own bucket
  })
})

describe('Turnstile on feedback writes', () => {
  it('rejects a missing token and stores nothing', async () => {
    const f = await count('feedback')
    const r = await call(feedback({ turnstile_token: undefined, visit_token: TOKEN('no-captcha') }))
    expect(r.status).toBe(403)
    expect(r.json).toEqual({ error: 'captcha_required' })
    expect(await count('feedback')).toBe(f)
  })

  it('rejects an invalid token and stores nothing', async () => {
    const f = await count('feedback')
    const r = await call(feedback({ turnstile_token: 'forged', visit_token: TOKEN('bad-captcha') }))
    expect(r.status).toBe(403)
    expect(r.json).toEqual({ error: 'captcha_failed' })
    expect(await count('feedback')).toBe(f)
  })

  it('rejects a non-string or oversize token', async () => {
    expect((await call(feedback({ turnstile_token: 12345 }))).status).toBe(403)
    expect((await call(feedback({ turnstile_token: 'a'.repeat(3000) }))).status).toBe(403)
  })

  it('is required on updates too, not just the first tap', async () => {
    const tok = TOKEN('update-needs-captcha')
    expect((await call(feedback({ visit_token: tok, star: 5 }))).status).toBe(200)
    const r = await call(feedback({ visit_token: tok, star: 1, turnstile_token: 'forged' }))
    expect(r.status).toBe(403)
    const row = await db.query<{ star_rating: number }>(`select f.star_rating from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [tok])
    expect(row.rows[0]?.star_rating).toBe(5)
  })

  it('does not even ask Cloudflare once the visitor is over the rate limit', async () => {
    const deps = { feedbackPerHour: 2 }
    const ip = '203.0.113.77'
    turnstileCalls = 0
    for (let i = 0; i < 2; i++) expect((await call(feedback({ visit_token: TOKEN(`rl-${i}`) }), { deps, ip })).status).toBe(200)
    const calls = turnstileCalls
    const blocked = await call(feedback({ visit_token: TOKEN('rl-over') }), { deps, ip })
    expect(blocked.status).toBe(429)
    expect(turnstileCalls).toBe(calls)
  })
})

describe('submit_feedback: one row per visit', () => {
  it('creates the row at the first tap and updates the same row afterwards', async () => {
    const tok = TOKEN('one-row')
    expect((await call(feedback({ visit_token: tok, star: 5 }))).json).toEqual({ ok: true })
    expect((await call(feedback({ visit_token: tok, star: 4 }))).json).toEqual({ ok: true })
    expect((await call(feedback({ visit_token: tok, star: 4, message: 'Great place' }))).json).toEqual({ ok: true })
    const rows = await db.query<{ star_rating: number; message: string }>(
      `select f.star_rating, f.message from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [tok],
    )
    expect(rows.rows).toEqual([{ star_rating: 4, message: 'Great place' }])
  })

  it("a visit can't edit another visit's row (and a token from one business is useless on another)", async () => {
    const t1 = TOKEN('victim')
    await call(feedback({ visit_token: t1, star: 5, message: 'victim text' }))
    await call(feedback({ visit_token: TOKEN('attacker'), star: 1, message: 'attacker text' }))
    const victim = await db.query<{ star_rating: number; message: string }>(
      `select f.star_rating, f.message from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [t1],
    )
    expect(victim.rows[0]).toEqual({ star_rating: 5, message: 'victim text' })

    const cross = await call(feedback({ slug: b.slug, visit_token: t1, star: 1, message: 'cross-business overwrite' }))
    expect(cross.status).toBe(403)
    expect(await count('feedback', `business_id = '${b.businessId}'`)).toBe(0)
  })

  it('works through an old slug', async () => {
    const t = await createTenant(db, 'Echo Eats', 'echo-eats')
    await db.query(`update public.businesses set slug = 'echo-eatery' where id = $1`, [t.businessId])
    expect((await call(feedback({ slug: 'echo-eats', visit_token: TOKEN('old-slug') }))).status).toBe(200)
    expect(await count('feedback', `business_id = '${t.businessId}'`)).toBe(1)
  })

  it('returns 404 for an unknown business and creates nothing', async () => {
    const f = await count('feedback')
    expect((await call(feedback({ slug: 'ghost-biz', visit_token: TOKEN('ghost') }))).status).toBe(404)
    expect(await count('feedback')).toBe(f)
  })
})

describe('submit_feedback: server-side validation', () => {
  const rejects = async (extra: Record<string, unknown>, error: string, status = 400) => {
    const f = await count('feedback')
    const r = await call(feedback({ visit_token: TOKEN(`v-${Math.random().toString(36).slice(2, 10)}`), ...extra }))
    expect({ status: r.status, json: r.json }, JSON.stringify(extra).slice(0, 80)).toEqual({ status, json: { error } })
    expect(await count('feedback')).toBe(f)
  }

  it.each([0, 6, -3, 2.5, '5', null, true])('rejects star %j', async (star) => {
    await rejects({ star }, 'invalid_star')
  })

  it('rejects malformed visit tokens', async () => {
    for (const visit_token of [undefined, '', 'short', 'has spaces in it and is long enough', 'x'.repeat(65), 42]) {
      expect((await call(feedback({ visit_token }))).json, String(visit_token)).toEqual({ error: 'invalid_token' })
    }
  })

  it('rejects oversize and non-string messages', async () => {
    await rejects({ message: 'x'.repeat(2001) }, 'invalid_message')
    await rejects({ message: { text: 'hi' } }, 'invalid_message')
    await rejects({ message: 12 }, 'invalid_message')
  })

  it('rejects malformed answers', async () => {
    await rejects({ answers: 'nope' }, 'invalid_answers')
    await rejects({ answers: Array.from({ length: 21 }, () => ({ question_id: 'x', answer: 'y' })) }, 'invalid_answers')
    await rejects({ answers: [{ question_id: 'x', answer: { nested: true } }] }, 'invalid_answers')
    await rejects({ answers: [{ answer: 'no id' }] }, 'invalid_answers')
    await rejects({ answers: [{ question_id: 'y'.repeat(41), answer: 'a' }] }, 'invalid_answers')
    await rejects({ answers: [{ question_id: 'x', answer: 'z'.repeat(2001) }] }, 'invalid_answers')
  })

  it("matches answers against the business's current questions and snapshots the prompt", async () => {
    const qs = await db.query<{ id: string; business_id: string; type: string }>(`select id, business_id, type from public.survey_questions`)
    const mine = qs.rows.filter((q) => q.business_id === a.businessId)
    const theirs = qs.rows.find((q) => q.business_id === b.businessId)!

    await rejects({ answers: [{ question_id: theirs.id, answer: 'sneaky' }] }, 'invalid_answers')
    await rejects({ answers: [{ question_id: mine.find((q) => q.type === 'multiple_choice')!.id, answer: 'Not an option' }] }, 'invalid_answers')

    const tok = TOKEN('survey-ok')
    const ok = await call(feedback({ visit_token: tok, star: 2, answers: [{ question_id: mine.find((q) => q.type === 'multiple_choice')!.id, answer: 'Wait time' }] }))
    expect(ok.json).toEqual({ ok: true })
    const row = await db.query<{ survey_answers: { prompt: string; answer: string }[] }>(
      `select f.survey_answers from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [tok],
    )
    expect(row.rows[0].survey_answers[0]).toMatchObject({ prompt: 'What fell short of your expectations?', answer: 'Wait time' })
  })

  it('accepts a contact email only with explicit consent', async () => {
    await rejects({ contact: { email: 'sam@example.com' } }, 'contact_requires_consent')
    await rejects({ contact: { email: 'sam@example.com', consent: false } }, 'contact_requires_consent')
    await rejects({ contact: { email: 'x'.repeat(260) + '@b.co', consent: true } }, 'invalid_contact')
    await rejects({ contact: { name: 'n'.repeat(121), consent: true } }, 'invalid_contact')
    await rejects({ contact: 'sam@example.com' }, 'invalid_contact')
    await rejects({ contact: { email: 'sam@example.com', consent: 'yes' } }, 'invalid_contact')
    expect((await call(feedback({ visit_token: TOKEN('consent-ok'), contact: { name: 'Sam', email: 'sam@example.com', consent: true } }))).status).toBe(200)
  })
})

describe('honeypot', () => {
  it('fakes success for bots and stores nothing at all', async () => {
    const before = [await count('feedback'), await count('events'), await count('feedback_secrets'), await count('rate_limits')]
    for (const website of ['http://spam.example', 'x', 1, true, { a: 1 }]) {
      for (const body of [feedback({ website }), { action: 'page_view', slug: a.slug, website }]) {
        const r = await call(body, { ip: '192.0.2.99' })
        expect(r.status).toBe(200)
        expect(r.json).toEqual({ ok: true })
      }
    }
    expect([await count('feedback'), await count('events'), await count('feedback_secrets'), await count('rate_limits')]).toEqual(before)
  })

  it('ignores an empty honeypot field (real visitors)', async () => {
    expect((await call(feedback({ website: '', visit_token: TOKEN('human') }))).status).toBe(200)
  })
})

describe('privacy and leakage', () => {
  it('only ever returns {ok} or {error}: no ids, tokens, stored values or hashes', async () => {
    const responses = [
      await call(feedback({ visit_token: TOKEN('leak-1'), message: 'secret message text' })),
      await call(feedback({ visit_token: TOKEN('leak-1'), message: 'changed' })),
      await call(feedback({ visit_token: TOKEN('leak-2'), star: 9 })),
      await call({ action: 'page_view', slug: a.slug }),
      await call({ action: 'page_view', slug: 'ghost-biz' }),
    ]
    for (const r of responses) {
      expect(Object.keys(r.json)).toHaveLength(1)
      expect(['ok', 'error']).toContain(Object.keys(r.json)[0])
      expect(r.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|secret message|owner_user_id|token_hash|198\.51\.100/)
    }
  })

  it('never stores the visitor IP or the raw visit token anywhere', async () => {
    const ip = '198.51.100.188'
    const tok = TOKEN('raw-token-check')
    await call(feedback({ visit_token: tok }), { ip })
    await call({ action: 'page_view', slug: a.slug }, { ip })
    expect(await dbContains(db, ip)).toBe(false)
    expect(await dbContains(db, tok)).toBe(false)
    expect(await dbContains(db, '198.51.100.23')).toBe(false)
  })

  it('treats a visitor with no IP header as one shared bucket instead of crashing', async () => {
    const handler = createSubmitPublicHandler(baseDeps())
    const res = await handler(new Request('https://example.test/x', { method: 'POST', body: JSON.stringify({ action: 'page_view', slug: a.slug }) }))
    expect(res.status).toBe(200)
  })
})

describe('fails closed', () => {
  it('refuses everything if the IP-hash secret is missing', async () => {
    const f = await count('events')
    const r = await call({ action: 'page_view', slug: a.slug }, { deps: { ipHashSecret: null } })
    expect(r).toMatchObject({ status: 500, json: { error: 'server_misconfigured' } })
    expect(await count('events')).toBe(f)
  })

  it('refuses feedback writes if Turnstile is not configured (never accepts them unchecked)', async () => {
    const f = await count('feedback')
    const r = await call(feedback({ visit_token: TOKEN('no-ts-config') }), { deps: { verifyTurnstile: null } })
    expect(r).toMatchObject({ status: 500, json: { error: 'server_misconfigured' } })
    expect(await count('feedback')).toBe(f)
  })

  it('hides database errors behind a generic 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await call({ action: 'page_view', slug: a.slug }, { deps: { rpc: async () => { throw new Error('relation "secret_table" exploded') } } })
    spy.mockRestore()
    expect(r.status).toBe(500)
    expect(r.json).toEqual({ error: 'server_error' })
    expect(r.text).not.toMatch(/secret_table|exploded/)
  })
})
