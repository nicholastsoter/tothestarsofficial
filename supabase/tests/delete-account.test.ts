import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeleteAccountHandler, type DeleteAccountDeps } from '../functions/delete-account/handler'
import { as, createDb, createTenant, seedFeedback, type Tenant } from './helpers'

let db: PGlite
let a: Tenant
let b: Tenant
let log: string[]

// users are keyed by token: token-a -> tenant A, etc.
function setup(over: Partial<DeleteAccountDeps> = {}) {
  const deps: DeleteAccountDeps = {
    getUser: async (t) => (t === 'token-a' ? { id: a.userId, email: 'alpha-cafe@example.com' } : t === 'token-b' ? { id: b.userId, email: 'bravo-bakery@example.com' } : null),
    findBusinessId: async (userId) => {
      log.push('findBusinessId')
      const r = await db.query<{ id: string }>(`select id from public.businesses where owner_user_id = $1`, [userId])
      return r.rows[0]?.id ?? null
    },
    deleteLogos: async (id) => {
      log.push(`deleteLogos:${id}`)
    },
    deleteAuthUser: async (id) => {
      log.push('deleteAuthUser')
      await db.query(`delete from auth.users where id = $1`, [id])
    },
    ...over,
  }
  const handler = createDeleteAccountHandler(deps)
  return async (body: unknown, token: string | null = 'token-a', method = 'POST') => {
    const res = await handler(
      new Request('https://example.test/functions/v1/delete-account', {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
      }),
    )
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : null }
  }
}

const rowsFor = async (t: Tenant) => {
  const q = async (sql: string) => (await db.query<{ n: number }>(sql, [t.businessId])).rows[0].n
  return {
    businesses: await q(`select count(*)::int n from public.businesses where id = $1`),
    surveys: await q(`select count(*)::int n from public.surveys where business_id = $1`),
    questions: await q(`select count(*)::int n from public.survey_questions where business_id = $1`),
    feedback: await q(`select count(*)::int n from public.feedback where business_id = $1`),
    events: await q(`select count(*)::int n from public.events where business_id = $1`),
    history: await q(`select count(*)::int n from public.slug_history where business_id = $1`),
  }
}

beforeEach(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
  for (const t of [a, b]) {
    const fb = await seedFeedback(db, t.businessId, 4, 'hello')
    await db.query(`insert into public.feedback_secrets (feedback_id, token_hash) values ($1::uuid, encode(sha256(convert_to($1::uuid::text, 'UTF8')), 'hex'))`, [fb])
    await db.query(`insert into public.events (business_id, type) values ($1, 'page_view')`, [t.businessId])
  }
  await as(db, 'authenticated', a.userId, () => db.query(`update public.businesses set slug = 'alpha-renamed' where id = $1`, [a.businessId]))
  log = []
})

describe('authentication and confirmation', () => {
  it('rejects missing or invalid tokens and deletes nothing', async () => {
    const call = setup()
    expect((await call({ confirm: 'alpha-cafe@example.com' }, null)).status).toBe(401)
    expect((await call({ confirm: 'alpha-cafe@example.com' }, 'forged')).status).toBe(401)
    expect(log).toEqual([])
    expect((await rowsFor(a)).businesses).toBe(1)
  })

  it.each([{}, { confirm: 42 }, { confirm: '' }, { confirm: 'DELETE' }, { confirm: 'bravo-bakery@example.com' }, { confirm: 'alpha-cafe@example.com.evil' }])(
    'refuses when the typed confirmation is %j',
    async (body) => {
      const call = setup()
      const r = await call(body)
      expect([400]).toContain(r.status)
      expect(log).toEqual([])
      expect(await rowsFor(a)).toMatchObject({ businesses: 1, feedback: 1 })
    },
  )

  it('accepts the account email regardless of case and surrounding spaces', async () => {
    const r = await setup()({ confirm: '  ALPHA-Cafe@Example.com ' })
    expect(r).toEqual({ status: 200, json: { ok: true } })
  })

  it('refuses other methods and answers preflight', async () => {
    const call = setup()
    expect((await call(null, 'token-a', 'GET')).status).toBe(405)
    expect((await call(null, null, 'OPTIONS')).status).toBe(204)
  })
})

describe('deletion', () => {
  it('removes logo files first, then the auth user, and cascades to every table', async () => {
    const r = await setup()({ confirm: 'alpha-cafe@example.com' })
    expect(r).toEqual({ status: 200, json: { ok: true } })
    expect(log).toEqual(['findBusinessId', `deleteLogos:${a.businessId}`, 'deleteAuthUser'])
    expect(await rowsFor(a)).toEqual({ businesses: 0, surveys: 0, questions: 0, feedback: 0, events: 0, history: 0 })
    expect((await db.query(`select 1 from public.feedback_secrets`)).rows).toHaveLength(1) // only B's remains
  })

  it("only ever deletes the caller: another business's data is untouched", async () => {
    const before = await rowsFor(b)
    await setup()({ confirm: 'alpha-cafe@example.com' }, 'token-a')
    expect(await rowsFor(b)).toEqual(before)
    expect((await db.query(`select 1 from auth.users where id = $1`, [b.userId])).rows).toHaveLength(1)
  })

  it("a caller can't name another user: the target always comes from the verified token", async () => {
    const r = await setup()({ confirm: 'bravo-bakery@example.com', userId: b.userId, business_id: b.businessId }, 'token-a')
    expect(r.status).toBe(400)
    expect((await rowsFor(b)).businesses).toBe(1)
  })

  it('still works for an account that never created a business', async () => {
    await db.query(`delete from public.businesses where id = $1`, [a.businessId])
    const r = await setup()({ confirm: 'alpha-cafe@example.com' })
    expect(r.status).toBe(200)
    expect(log).toEqual(['findBusinessId', 'deleteAuthUser'])
  })
})

describe('failure handling', () => {
  it('stops before touching the account if logo cleanup fails, so it can be retried', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await setup({
      deleteLogos: async () => {
        log.push('deleteLogos')
        throw new Error('storage down')
      },
    })({ confirm: 'alpha-cafe@example.com' })
    spy.mockRestore()
    expect(r).toEqual({ status: 500, json: { error: 'storage_cleanup_failed' } })
    expect(log).not.toContain('deleteAuthUser')
    expect(await rowsFor(a)).toMatchObject({ businesses: 1, feedback: 1 })
    // retry succeeds
    expect((await setup()({ confirm: 'alpha-cafe@example.com' })).status).toBe(200)
  })

  it('reports a failed user deletion distinctly', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await setup({ deleteAuthUser: async () => { throw new Error('auth down') } })({ confirm: 'alpha-cafe@example.com' })
    spy.mockRestore()
    expect(r).toEqual({ status: 500, json: { error: 'user_delete_failed' } })
  })
})
