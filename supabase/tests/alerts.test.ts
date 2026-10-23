import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildAlertEmail, escapeHtml, type AlertClaim } from '../functions/_shared/alertEmail'
import { createSubmitPublicHandler, type SubmitPublicDeps } from '../functions/submit-public/handler'
import { createDb, createTenant, dbContains, pgRpc, type Tenant } from './helpers'

const claim = (over: Partial<AlertClaim> = {}): AlertClaim => ({
  feedback_id: '11111111-1111-4111-8111-111111111111',
  to_email: 'owner@example.com',
  business_name: "Joe's Pizza",
  star_rating: 2,
  message: 'Cold pizza',
  answers: [{ prompt: 'What fell short?', answer: 'Wait time' }],
  created_at: '2026-01-01T00:00:00Z',
  ...over,
})

describe('buildAlertEmail', () => {
  it('contains the stars, the message, the answers and an inbox link', () => {
    const e = buildAlertEmail(claim(), 'https://app.example.com/inbox')
    expect(e.to).toBe('owner@example.com')
    expect(e.subject).toBe("New 2 stars feedback for Joe's Pizza")
    for (const body of [e.html, e.text]) {
      expect(body).toContain('Cold pizza')
      expect(body).toContain('Wait time')
      expect(body).toContain('https://app.example.com/inbox')
    }
  })

  it('escapes every customer-controlled value so injected markup cannot run', () => {
    const evil = `<script>alert(1)</script><img src=x onerror=alert(2)> "quoted" 'single' \`tick\` & more`
    const e = buildAlertEmail(
      claim({ business_name: `<b>Biz</b>${evil}`, message: evil, answers: [{ prompt: evil, answer: evil }] }),
      'https://app.example.com/inbox',
    )
    expect(e.html).not.toMatch(/<script|<img|<b>Biz/i)
    expect(e.html).toContain('&lt;img src=x onerror=alert(2)&gt;') // present only as visible, inert text
    expect(e.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(e.html).toContain('&amp; more')
    expect(e.html).not.toMatch(/"quoted"/) // quotes are entity-escaped too
    // the only tags are the ones the template itself writes
    const tags = [...e.html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase())
    expect(new Set(tags)).toEqual(new Set(['html', 'body', 'h2', 'p', 'strong', 'ul', 'li', 'em', 'a']))
  })

  it('keeps newlines out of the subject line (no header injection)', () => {
    const e = buildAlertEmail(claim({ business_name: 'Biz\r\nBcc: attacker@evil.com\nSubject: hacked' }), 'https://app.example.com/inbox')
    expect(e.subject).not.toMatch(/[\r\n]/)
    expect(e.subject.length).toBeLessThan(120)
  })

  it('handles message-only, answers-only and rating answers; never claims more than 5 stars', () => {
    const only = buildAlertEmail(claim({ message: null, answers: [{ prompt: 'Clean?', answer: 3 }] }), 'https://a.test/inbox')
    expect(only.html).not.toContain('Message')
    expect(only.html).toContain('3 out of 5')
    const msg = buildAlertEmail(claim({ answers: [] }), 'https://a.test/inbox')
    expect(msg.html).not.toContain('Survey answers')
    expect(buildAlertEmail(claim({ star_rating: 99 }), 'https://a.test/inbox').subject).toContain('5 stars')
    expect(buildAlertEmail(claim({ star_rating: 1 }), 'https://a.test/inbox').subject).toContain('1 star ')
  })

  it('has no place for contact details', () => {
    const withContact = { ...claim(), contact_name: 'Sam Rivera', contact_email: 'sam@example.com' } as AlertClaim
    const e = buildAlertEmail(withContact, 'https://a.test/inbox')
    expect(e.html + e.text + e.subject).not.toMatch(/Rivera|sam@example/)
  })

  it('refuses a non-http inbox link', () => {
    expect(() => buildAlertEmail(claim(), 'javascript:alert(1)')).toThrow()
    expect(() => buildAlertEmail(claim(), 'not a url')).toThrow()
  })

  it('escapeHtml covers the dangerous characters', () => {
    expect(escapeHtml(`<>&"'\``)).toBe('&lt;&gt;&amp;&quot;&#39;&#96;')
  })
})

// ---- end to end through the real submit-public handler and real SQL ----

let db: PGlite
let a: Tenant
let b: Tenant
const TOKEN = (n: string) => `alert-${n}`.padEnd(24, 'x')
const sent: AlertClaim[] = []

const deps = (over: Partial<SubmitPublicDeps> = {}): SubmitPublicDeps => ({
  rpc: pgRpc(db),
  verifyTurnstile: async () => true,
  ipHashSecret: 'unit-test-secret',
  sendAlert: async (c) => {
    sent.push(c)
  },
  ...over,
})

async function post(body: Record<string, unknown>, over: Partial<SubmitPublicDeps> = {}, ip = '198.51.100.9') {
  const res = await createSubmitPublicHandler(deps(over))(
    new Request('https://x.test/f', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ turnstile_token: 'ok', slug: a.slug, action: 'submit_feedback', ...body }) }),
  )
  return { status: res.status, json: await res.json() }
}
const fbq = (visit: string, star: number, message?: string, extra: Record<string, unknown> = {}) => post({ visit_token: TOKEN(visit), star, message, ...extra })

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
})

describe('alert triggering through submit-public', () => {
  it('sends exactly one email for a 1-3 star item that has content, even if the customer keeps editing', async () => {
    sent.length = 0
    expect((await fbq('once', 2)).status).toBe(200) // star tap
    expect(sent).toHaveLength(0)
    await fbq('once', 2, 'Cold coffee')
    expect(sent).toHaveLength(1)
    await fbq('once', 2, 'Cold coffee and rude staff')
    await fbq('once', 1, 'Cold coffee and rude staff')
    await fbq('once', 3, 'Never mind, it was fine')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ star_rating: 2, message: 'Cold coffee', business_name: 'Alpha Cafe', to_email: 'alpha-cafe@example.com' })
  })

  it('does not alert on bare star taps or on 4-5 stars', async () => {
    sent.length = 0
    await fbq('bare-1', 1)
    await fbq('bare-2', 3)
    await fbq('four', 4, 'Pretty good')
    await fbq('five', 5, 'Perfect')
    expect(sent).toHaveLength(0)
  })

  it('alerts for survey answers without a message', async () => {
    sent.length = 0
    const q = (await db.query<{ id: string }>(`select id from public.survey_questions where business_id = $1 and type = 'multiple_choice'`, [a.businessId])).rows[0].id
    await fbq('survey-only', 2, undefined, { answers: [{ question_id: q, answer: 'Price' }] })
    expect(sent).toHaveLength(1)
    expect(sent[0].answers).toEqual([{ prompt: 'What fell short of your expectations?', answer: 'Price' }])
    expect(sent[0].message).toBeNull()
  })

  it('never alerts when no email provider is configured, and does not burn the claim', async () => {
    sent.length = 0
    await fbq('no-provider', 1, 'Awful', {})
    // (the default deps have a sender; run the same visit again with sendAlert: null on a new visit)
    const before = sent.length
    await post({ visit_token: TOKEN('np2'), star: 1, message: 'Awful again' }, { sendAlert: null })
    expect(sent.length).toBe(before)
    const row = await db.query<{ alert_sent_at: Date | null }>(`select f.alert_sent_at from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [TOKEN('np2')])
    expect(row.rows[0].alert_sent_at).toBeNull()
  })

  it('respects the owner switching alerts off', async () => {
    sent.length = 0
    await db.query(`update public.businesses set alerts_enabled = false where id = $1`, [b.businessId])
    await post({ slug: b.slug, visit_token: TOKEN('b-off'), star: 1, message: 'Bad' })
    expect(sent).toHaveLength(0)
  })

  it("a failed send never fails the customer's submission, and the next edit retries it", async () => {
    sent.length = 0
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = async () => {
      throw new Error('provider down: key re_SECRET123')
    }
    const first = await post({ visit_token: TOKEN('retry'), star: 1, message: 'Broken' }, { sendAlert: failing })
    expect(first).toEqual({ status: 200, json: { ok: true } })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('re_SECRET123') // provider error text isn't logged
    spy.mockRestore()
    expect(sent).toHaveLength(0)
    await fbq('retry', 1, 'Broken, with more detail') // next edit: the claim was released, so it sends now
    expect(sent).toHaveLength(1)
  })

  it('survives the database failing during the alert step', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const flaky = pgRpc(db)
    const res = await post({ visit_token: TOKEN('db-fail'), star: 1, message: 'Bad' }, { rpc: async (fn, args) => (fn === 'claim_low_rating_alert' ? Promise.reject(new Error('boom')) : flaky(fn, args)) })
    spy.mockRestore()
    expect(res).toEqual({ status: 200, json: { ok: true } })
  })

  it('never puts alert data or contact details in the response', async () => {
    const r = await fbq('response-check', 1, 'Secret complaint', { contact: { name: 'Sam Rivera', email: 'sam@example.com', consent: true } })
    expect(r.json).toEqual({ ok: true })
  })

  it('never passes contact details to the email sender', async () => {
    sent.length = 0
    await fbq('contact-alert', 2, 'Slow service', { contact: { name: 'Pat Doe', email: 'pat@example.com', consent: true } })
    expect(sent).toHaveLength(1)
    expect(JSON.stringify(sent[0])).not.toMatch(/Pat Doe|pat@example/)
    const e = buildAlertEmail(sent[0], 'https://a.test/inbox')
    expect(e.html + e.text).not.toMatch(/Pat Doe|pat@example/)
  })

  it('limits one business to 10 alert emails per hour', async () => {
    sent.length = 0
    const c = await createTenant(db, 'Cora Cafe', 'cora-cafe')
    for (let i = 0; i < 14; i++) {
      await post({ slug: c.slug, visit_token: TOKEN(`wave-${i}`), star: 1, message: `spam ${i}` }, {}, `203.0.113.${i + 1}`)
    }
    expect(sent.filter((s) => s.business_name === 'Cora Cafe')).toHaveLength(10)
    // all 14 submissions were still saved
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.feedback where business_id = $1`, [c.businessId])).rows[0].n).toBe(14)
    // another business is unaffected
    sent.length = 0
    await fbq('other-biz-ok', 1, 'Still alerts')
    expect(sent).toHaveLength(1)
  })

  it("never copies the owner's email into any public table", async () => {
    expect(await dbContains(db, 'alpha-cafe@example.com')).toBe(false)
    expect(await dbContains(db, 'cora-cafe@example.com')).toBe(false)
  })
})
