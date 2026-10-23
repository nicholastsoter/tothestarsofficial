import { describe, expect, it, vi } from 'vitest'
import { createDeleteAuthUser, createDeleteLogos, createGetUser, createRpc, createTurnstileVerifier } from '../functions/_shared/clients'
import { clientIp, hmacHex } from '../functions/_shared/http'

const ID = '11111111-1111-4111-8111-111111111111'
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('createRpc', () => {
  it('posts JSON to the RPC endpoint with the service key, and does not leak error bodies', async () => {
    const f = vi.fn(async () => ok({ found: true }))
    expect(await createRpc('https://p.supabase.co', 'svc-key', f as unknown as typeof fetch)('public_gate', { p_slug: 'x' })).toEqual({ found: true })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/public_gate')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer svc-key')
    expect(init.body).toBe('{"p_slug":"x"}')

    const bad = createRpc('https://p.supabase.co', 'svc-key', (async () => ok({ message: 'SECRET DETAIL' }, 500)) as unknown as typeof fetch)
    await expect(bad('x', {})).rejects.toThrow(/status 500$/)
    await expect(bad('x', {})).rejects.not.toThrow(/SECRET/)
  })
})

describe('createTurnstileVerifier', () => {
  it('sends the secret and token form-encoded and trusts only success: true', async () => {
    const f = vi.fn(async () => ok({ success: true }))
    expect(await createTurnstileVerifier('the-secret', f as unknown as typeof fetch)('tok')).toBe(true)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(String(init.body)).toBe('secret=the-secret&response=tok')
  })
  it.each([ok({ success: false }), ok({}), ok({ success: 'true' }), ok({}, 500)])('treats %# as invalid', async (res) => {
    expect(await createTurnstileVerifier('s', (async () => res) as unknown as typeof fetch)('tok')).toBe(false)
  })
  it('treats a network error as invalid (fails closed)', async () => {
    expect(await createTurnstileVerifier('s', (async () => { throw new Error('down') }) as unknown as typeof fetch)('tok')).toBe(false)
  })
})

describe('createGetUser', () => {
  it('returns the user for a valid token and null otherwise', async () => {
    expect(await createGetUser('https://p.supabase.co', 'anon', (async () => ok({ id: ID, email: 'a@b.co' })) as unknown as typeof fetch)('t')).toEqual({ id: ID, email: 'a@b.co' })
    expect(await createGetUser('https://p.supabase.co', 'anon', (async () => ok({}, 401)) as unknown as typeof fetch)('t')).toBeNull()
    expect(await createGetUser('https://p.supabase.co', 'anon', (async () => ok({ id: 'not-a-uuid' })) as unknown as typeof fetch)('t')).toBeNull()
  })
})

describe('storage and auth cleanup', () => {
  it('lists then deletes files under the business folder until none remain', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok([{ name: 'logo-1.png' }, { name: 'logo-2.png' }]))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok([]))
    await createDeleteLogos('https://p.supabase.co', 'svc', f as unknown as typeof fetch)(ID)
    const del = f.mock.calls[1] as unknown as [string, RequestInit]
    expect(del[0]).toBe('https://p.supabase.co/storage/v1/object/logos')
    expect(del[1].method).toBe('DELETE')
    expect(JSON.parse(del[1].body as string)).toEqual({ prefixes: [`${ID}/logo-1.png`, `${ID}/logo-2.png`] })
  })
  it('throws if storage fails, and refuses a malformed id', async () => {
    await expect(createDeleteLogos('https://p.supabase.co', 'svc', (async () => ok({}, 500)) as unknown as typeof fetch)(ID)).rejects.toThrow()
    await expect(createDeleteLogos('https://p.supabase.co', 'svc', (async () => ok([])) as unknown as typeof fetch)('../../etc')).rejects.toThrow()
  })
  it('calls the auth admin delete endpoint for exactly that user', async () => {
    const f = vi.fn(async () => ok({}))
    await createDeleteAuthUser('https://p.supabase.co', 'svc', f as unknown as typeof fetch)(ID)
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(`https://p.supabase.co/auth/v1/admin/users/${ID}`)
    await expect(createDeleteAuthUser('https://p.supabase.co', 'svc', f as unknown as typeof fetch)('x/../y')).rejects.toThrow()
  })
})

describe('http helpers', () => {
  it('prefers the Cloudflare-set IP header over a client-forgeable one', () => {
    const req = (h: Record<string, string>) => new Request('https://x.test', { headers: h })
    expect(clientIp(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '6.6.6.6' }))).toBe('1.1.1.1')
    expect(clientIp(req({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }))).toBe('2.2.2.2')
    expect(clientIp(req({}))).toBeNull()
  })
  it('hashes deterministically, differently per secret, and never contains the input', async () => {
    const h1 = await hmacHex('secret-1', '203.0.113.9')
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(await hmacHex('secret-1', '203.0.113.9')).toBe(h1)
    expect(await hmacHex('secret-2', '203.0.113.9')).not.toBe(h1)
    expect(h1).not.toContain('203')
  })
})
