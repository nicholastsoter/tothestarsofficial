import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildTestAlertEmail, type AlertClaim } from '../functions/_shared/alertEmail'
import { createAlertSender, loadAlertConfig } from '../functions/_shared/alertSender'
import { createResendSend } from '../functions/_shared/resend'
import { createSendTestAlertHandler, type SendTestAlertDeps } from '../functions/send-test-alert/handler'
import { createSubmitPublicHandler } from '../functions/submit-public/handler'
import { createDb, createTenant, dbContains, pgRpc, type Tenant } from './helpers'

const KEY = 're_live_SECRET_KEY_0123456789'
const FROM = 'To The Stars <alerts@example.com>'
const PROVIDER_BODY = '{"name":"validation_error","message":"The re_live_SECRET_KEY_0123456789 key is invalid for owner@private.example"}'

const env = (over: Record<string, string | undefined> = {}) => (name: string) =>
  ({ RESEND_API_KEY: KEY, ALERT_FROM_EMAIL: FROM, APP_BASE_URL: 'https://app.example.com', ...over })[name]

const claim = (over: Partial<AlertClaim> = {}): AlertClaim => ({
  feedback_id: '11111111-1111-4111-8111-111111111111', to_email: 'owner@example.com', business_name: "Joe's Pizza", star_rating: 2,
  message: 'Cold pizza', answers: [], created_at: '2026-01-01T00:00:00Z', ...over,
})

const ok = () => new Response('{"id":"abc"}', { status: 200 })

describe('createResendSend', () => {
  it('posts the email to Resend with the key in a header and the configured sender', async () => {
    const f = vi.fn(async () => ok())
    await createResendSend(KEY, FROM, f as unknown as typeof fetch)({ to: 'owner@example.com', subject: 'Subject', html: '<p>hi</p>', text: 'hi' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    expect(url).not.toContain(KEY)
    expect(JSON.parse(init.body as string)).toEqual({ from: FROM, to: ['owner@example.com'], subject: 'Subject', html: '<p>hi</p>', text: 'hi' })
    expect(init.body as string).not.toContain(KEY)
  })

  it('throws on any non-2xx with only the status, never the provider response text', async () => {
    for (const status of [400, 401, 403, 422, 429, 500, 503]) {
      const send = createResendSend(KEY, FROM, (async () => new Response(PROVIDER_BODY, { status })) as unknown as typeof fetch)
      const err = await send({ to: 'a@b.co', subject: 's', html: 'h', text: 't' }).catch((e) => e as Error)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toBe(`email provider responded with status ${status}`)
      expect((err as Error).message).not.toMatch(/SECRET|private\.example|validation_error/)
    }
  })

  it('propagates a network failure', async () => {
    const send = createResendSend(KEY, FROM, (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch)
    await expect(send({ to: 'a@b.co', subject: 's', html: 'h', text: 't' })).rejects.toThrow()
  })
})

describe('loadAlertConfig (missing or malformed secrets turn alerts OFF)', () => {
  it('builds a working sender from valid secrets, with the inbox link on the app address', async () => {
    const cfg = loadAlertConfig(env(), (async () => ok()) as unknown as typeof fetch)
    expect(cfg).not.toBeNull()
    expect(cfg!.inboxUrl).toBe('https://app.example.com/inbox')
  })

  it.each([
    ['no API key', { RESEND_API_KEY: undefined }],
    ['an empty API key', { RESEND_API_KEY: '   ' }],
    ['an API key with spaces', { RESEND_API_KEY: 're_abc def' }],
    ['no sender', { ALERT_FROM_EMAIL: undefined }],
    ['an empty sender', { ALERT_FROM_EMAIL: '' }],
    ['a sender that is not an email', { ALERT_FROM_EMAIL: 'alerts' }],
    ['a sender with a line break (header injection)', { ALERT_FROM_EMAIL: 'a@example.com\r\nBcc: evil@example.com' }],
    ['a sender with angle brackets but no address', { ALERT_FROM_EMAIL: 'Name <nope>' }],
    ['no app address', { APP_BASE_URL: undefined }],
    ['an app address that is not a URL', { APP_BASE_URL: 'tothestars' }],
    ['a non-http app address', { APP_BASE_URL: 'javascript:alert(1)' }],
  ])('returns null for %s', (_label, over) => {
    expect(loadAlertConfig(env(over))).toBeNull()
  })

  it('accepts a plain address, a named address, and http for local testing; keeps only the origin of the app address', () => {
    expect(loadAlertConfig(env({ ALERT_FROM_EMAIL: 'alerts@example.com' }))).not.toBeNull()
    expect(loadAlertConfig(env({ ALERT_FROM_EMAIL: 'onboarding@resend.dev' }))).not.toBeNull()
    expect(loadAlertConfig(env({ APP_BASE_URL: 'http://localhost:5173' }))!.inboxUrl).toBe('http://localhost:5173/inbox')
    expect(loadAlertConfig(env({ APP_BASE_URL: 'https://app.example.com/some/path?x=1' }))!.inboxUrl).toBe('https://app.example.com/inbox')
  })

  it('sends the alert email through the provider using the configured sender', async () => {
    const f = vi.fn(async () => ok())
    await createAlertSender(loadAlertConfig(env(), f as unknown as typeof fetch)!)(claim())
    const body = JSON.parse(((f.mock.calls[0] as unknown) as [string, RequestInit])[1].body as string)
    expect(body.from).toBe(FROM)
    expect(body.to).toEqual(['owner@example.com'])
    expect(body.subject).toContain('2 stars')
    expect(body.html).toContain('https://app.example.com/inbox')
  })
})

describe('buildTestAlertEmail', () => {
  it('is unmistakably a test, uses sample content only, and goes to the given address', () => {
    const e = buildTestAlertEmail('owner@example.com', "Joe's Pizza", 'https://app.example.com/inbox')
    expect(e.to).toBe('owner@example.com')
    expect(e.subject.startsWith('[TEST]')).toBe(true)
    expect(e.html).toContain('TEST EMAIL')
    expect(e.text.startsWith('TEST EMAIL')).toBe(true)
    expect(e.html).toContain('sample message')
    expect(e.html).toContain('https://app.example.com/inbox')
  })
  it('escapes the business name', () => {
    const e = buildTestAlertEmail('o@example.com', '<script>x</script>', 'https://a.test/inbox')
    expect(e.html).not.toContain('<script>')
  })
})

// ---------------- send-test-alert ----------------

let db: PGlite
beforeAll(async () => {
  db = await createDb()
})

const U1 = '11111111-aaaa-4aaa-8aaa-111111111111'
const U2 = '22222222-bbbb-4bbb-8bbb-222222222222'

function testAlert(over: Partial<SendTestAlertDeps> = {}) {
  const sent: { to: string; subject: string; html: string }[] = []
  const deps: SendTestAlertDeps = {
    getUser: async (t) => (t === 't1' ? { id: U1, email: 'owner1@example.com' } : t === 't2' ? { id: U2, email: 'owner2@example.com' } : t === 'noemail' ? { id: U1, email: null } : null),
    findBusinessName: async () => "Joe's Pizza",
    rpc: pgRpc(db),
    email: { send: async (e) => { sent.push(e) }, inboxUrl: 'https://app.example.com/inbox' },
    ...over,
  }
  const handler = createSendTestAlertHandler(deps)
  const call = async (token: string | null = 't1', body: unknown = undefined, method = 'POST') => {
    const res = await handler(new Request('https://x.test/f', { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined }))
    const text = await res.text()
    return { status: res.status, text, json: text ? JSON.parse(text) : null }
  }
  return { call, sent }
}

describe('send-test-alert', () => {
  it('requires a logged-in user', async () => {
    const { call, sent } = testAlert()
    expect((await call(null)).status).toBe(401)
    expect((await call('forged')).status).toBe(401)
    expect(sent).toHaveLength(0)
  })

  it("sends one labelled test email to the caller's own address only, ignoring any address in the request", async () => {
    const { call, sent } = testAlert()
    const r = await call('t1', { to: 'attacker@evil.com', email: 'attacker@evil.com', cc: 'x@y.z' })
    expect(r).toMatchObject({ status: 200, json: { ok: true, sent_to: 'owner1@example.com' } })
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('owner1@example.com')
    expect(sent[0].subject.startsWith('[TEST]')).toBe(true)
    expect(JSON.stringify(sent)).not.toContain('attacker')
  })

  it('limits each account to 3 test emails an hour, counted per account', async () => {
    await db.query(`delete from public.rate_limits`)
    const { call, sent } = testAlert()
    for (let i = 0; i < 3; i++) expect((await call('t1')).status).toBe(200)
    const blocked = await call('t1')
    expect(blocked).toMatchObject({ status: 429, json: { error: 'rate_limited' } })
    expect(sent).toHaveLength(3)
    expect((await call('t2')).status).toBe(200) // another owner is unaffected
  })

  it('answers "not configured" without using up the owner\'s tries when the email secrets are missing', async () => {
    await db.query(`delete from public.rate_limits`)
    const { call, sent } = testAlert({ email: null })
    for (let i = 0; i < 5; i++) expect((await call('t1')).json).toEqual({ error: 'not_configured' })
    expect(sent).toHaveLength(0)
    expect((await db.query(`select 1 from public.rate_limits where key like 'testalert:%'`)).rows).toHaveLength(0)
  })

  it('hides provider failures behind a generic error and never logs provider text', async () => {
    await db.query(`delete from public.rate_limits`)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const send = createResendSend(KEY, FROM, (async () => new Response(PROVIDER_BODY, { status: 403 })) as unknown as typeof fetch)
    const { call } = testAlert({ email: { send, inboxUrl: 'https://app.example.com/inbox' } })
    const r = await call('t1')
    const logged = JSON.stringify(spy.mock.calls)
    spy.mockRestore()
    expect(r).toMatchObject({ status: 502, json: { error: 'send_failed' } })
    expect(r.text + logged).not.toMatch(/SECRET|private\.example|validation_error|403/)
  })

  it('handles a user with no email, other methods and preflight', async () => {
    const { call } = testAlert()
    expect((await call('noemail')).json).toEqual({ error: 'no_email' })
    expect((await call('t1', undefined, 'GET')).status).toBe(405)
    expect((await call(null, undefined, 'OPTIONS')).status).toBe(204)
  })

  it('still answers when the business lookup fails (generic error, nothing sent)', async () => {
    await db.query(`delete from public.rate_limits`)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { call, sent } = testAlert({ findBusinessName: async () => { throw new Error('db down: secret detail') } })
    const r = await call('t1')
    spy.mockRestore()
    expect(r).toMatchObject({ status: 502, json: { error: 'send_failed' } })
    expect(r.text).not.toContain('secret detail')
    expect(sent).toHaveLength(0)
  })
})

// ---------------- real alert flow with the Resend sender (provider mocked) ----------------

describe('alert emails through submit-public with the Resend sender', () => {
  let a: Tenant
  const TOKEN = (n: string) => `resend-${n}`.padEnd(24, 'x')
  const slugOf = () => a.slug

  beforeAll(async () => {
    a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  })

  function flow(providerFetch: typeof fetch, secrets: Record<string, string | undefined> = {}) {
    const cfg = loadAlertConfig(env(secrets), providerFetch)
    const handler = createSubmitPublicHandler({
      rpc: pgRpc(db), verifyTurnstile: async () => true, ipHashSecret: 'unit-test-secret',
      sendAlert: cfg ? createAlertSender(cfg) : null,
    })
    return async (visit: string, star: number, message: string | null) => {
      const res = await handler(new Request('https://x.test/f', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.7' }, body: JSON.stringify({ action: 'submit_feedback', slug: slugOf(), visit_token: TOKEN(visit), star, message, turnstile_token: 'ok' }) }))
      return { status: res.status, text: await res.text() }
    }
  }
  const alertSentAt = async (visit: string) =>
    (await db.query<{ alert_sent_at: Date | null }>(`select f.alert_sent_at from public.feedback f join public.feedback_secrets s on s.feedback_id = f.id where s.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [TOKEN(visit)])).rows[0].alert_sent_at

  it('sends one real-looking email to the owner, with no customer contact details', async () => {
    const provider = vi.fn(async () => ok())
    const submit = flow(provider as unknown as typeof fetch)
    const r = await submit('happy', 2, 'Cold coffee')
    expect(r).toEqual({ status: 200, text: '{"ok":true}' })
    expect(provider).toHaveBeenCalledTimes(1)
    const body = JSON.parse(((provider.mock.calls[0] as unknown) as [string, RequestInit])[1].body as string)
    expect(body.to).toEqual(['alpha-cafe@example.com'])
    expect(body.html).toContain('Cold coffee')
    expect(await alertSentAt('happy')).not.toBeNull()
    await submit('happy', 1, 'Cold coffee, rude staff') // an edit: no second email
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('hands the claim back when the provider fails, never shows the customer anything, and retries on the next edit', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = vi.fn(async () => new Response(PROVIDER_BODY, { status: 500 }))
    const r = await flow(failing as unknown as typeof fetch)('flaky', 1, 'Awful')
    const logged = JSON.stringify(spy.mock.calls)
    spy.mockRestore()
    expect(r).toEqual({ status: 200, text: '{"ok":true}' }) // the customer's feedback is saved and they see success
    expect(failing).toHaveBeenCalledTimes(1)
    expect(await alertSentAt('flaky')).toBeNull() // claim handed back
    expect(r.text + logged).not.toMatch(/SECRET|private\.example|validation_error/)

    const working = vi.fn(async () => ok())
    await flow(working as unknown as typeof fetch)('flaky', 1, 'Awful, and now with detail')
    expect(working).toHaveBeenCalledTimes(1)
    expect(await alertSentAt('flaky')).not.toBeNull()
  })

  it('hands the claim back on a network error too', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = vi.fn(async () => { throw new TypeError('fetch failed') })
    const r = await flow(down as unknown as typeof fetch)('offline', 2, 'Slow')
    spy.mockRestore()
    expect(r.status).toBe(200)
    expect(await alertSentAt('offline')).toBeNull()
  })

  it.each([
    ['RESEND_API_KEY', { RESEND_API_KEY: undefined }],
    ['ALERT_FROM_EMAIL', { ALERT_FROM_EMAIL: undefined }],
    ['APP_BASE_URL', { APP_BASE_URL: undefined }],
    ['an invalid ALERT_FROM_EMAIL', { ALERT_FROM_EMAIL: 'not an email' }],
    ['an invalid APP_BASE_URL', { APP_BASE_URL: 'ftp://nope' }],
  ])('with %s missing or bad: no provider call, nothing claimed, customer unaffected', async (name, secrets) => {
    const provider = vi.fn(async () => ok())
    const r = await flow(provider as unknown as typeof fetch, secrets)(`nosecret-${name.length}`, 1, 'Bad')
    expect(r).toEqual({ status: 200, text: '{"ok":true}' })
    expect(provider).not.toHaveBeenCalled()
    expect(await alertSentAt(`nosecret-${name.length}`)).toBeNull()
  })

  it('an alert held back by missing secrets goes out once the secrets are fixed and the customer edits again', async () => {
    const provider = vi.fn(async () => ok())
    await flow(provider as unknown as typeof fetch, { RESEND_API_KEY: undefined })('late', 1, 'Terrible')
    expect(provider).not.toHaveBeenCalled()
    await flow(provider as unknown as typeof fetch)('late', 1, 'Terrible, more words')
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('a bad inbox link makes the send fail safely (claim handed back)', async () => {
    // loadAlertConfig refuses bad links, so build the failure at the sender instead
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cfg = { send: vi.fn(async () => {}), inboxUrl: 'not a url' }
    const handler = createSubmitPublicHandler({ rpc: pgRpc(db), verifyTurnstile: async () => true, ipHashSecret: 's', sendAlert: createAlertSender(cfg) })
    const res = await handler(new Request('https://x.test/f', { method: 'POST', body: JSON.stringify({ action: 'submit_feedback', slug: slugOf(), visit_token: TOKEN('badurl'), star: 1, message: 'Bad', turnstile_token: 'ok' }) }))
    spy.mockRestore()
    expect(res.status).toBe(200)
    expect(cfg.send).not.toHaveBeenCalled()
    expect(await alertSentAt('badurl')).toBeNull()
  })

  it('never stores the API key, sender or owner email in any table', async () => {
    expect(await dbContains(db, KEY)).toBe(false)
    expect(await dbContains(db, 'alerts@example.com')).toBe(false)
    expect(await dbContains(db, 'alpha-cafe@example.com')).toBe(false)
  })
})
