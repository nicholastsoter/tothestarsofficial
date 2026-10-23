import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, createDb, createTenant, type Tenant } from './helpers'

let db: PGlite
let a: Tenant
let b: Tenant

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
})

const hit = (key: string, limit: number, windowSeconds = 3600) =>
  as(db, 'service_role', null, () =>
    db.query<{ ok: boolean }>(`select public.rate_limit_hit($1, $2, $3) as ok`, [key, limit, windowSeconds]),
  ).then((r) => r.rows[0].ok)

describe('rate limiting', () => {
  it('allows up to the limit and blocks the next request', async () => {
    const results: boolean[] = []
    for (let i = 0; i < 32; i++) results.push(await hit('public:biz1:iphash1', 30))
    expect(results.slice(0, 30).every(Boolean)).toBe(true)
    expect(results[30]).toBe(false)
    expect(results[31]).toBe(false)
  })

  it('counts each business and each visitor separately', async () => {
    for (let i = 0; i < 5; i++) await hit('public:biz2:iphash1', 5)
    expect(await hit('public:biz2:iphash1', 5)).toBe(false)
    expect(await hit('public:biz3:iphash1', 5)).toBe(true) // different business
    expect(await hit('public:biz2:iphash2', 5)).toBe(true) // different visitor
  })

  it('can be called only by the service role', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        as(db, role, role === 'anon' ? null : a.userId, () => db.query(`select public.rate_limit_hit('x', 1, 60)`)),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('keeps counters unreadable and unwritable by anyone but the service role', async () => {
    await expect(as(db, 'authenticated', a.userId, () => db.query(`select * from public.rate_limits`))).rejects.toThrow(/permission denied/)
    await expect(as(db, 'authenticated', a.userId, () => db.query(`delete from public.rate_limits`))).rejects.toThrow(/permission denied/)
    await expect(as(db, 'anon', null, () => db.query(`select * from public.rate_limits`))).rejects.toThrow(/permission denied/)
  })

  it('cleans up old windows', async () => {
    await db.query(`insert into public.rate_limits (key, window_start, count) values ('old', now() - interval '3 days', 1)`)
    await as(db, 'service_role', null, () => db.query(`select public.cleanup_rate_limits()`))
    const r = await db.query(`select 1 from public.rate_limits where key = 'old'`)
    expect(r.rows).toHaveLength(0)
  })
})

describe('function permissions', () => {
  it('stops visitors from calling internal helpers directly', async () => {
    await expect(as(db, 'anon', null, () => db.query(`select public.is_business_owner($1)`, [a.businessId]))).rejects.toThrow(
      /permission denied/,
    )
    await expect(as(db, 'authenticated', a.userId, () => db.query(`select public.cleanup_rate_limits()`))).rejects.toThrow(
      /permission denied/,
    )
  })

  it('answers "do I own this?" correctly for the caller', async () => {
    const mine = await as(db, 'authenticated', a.userId, () =>
      db.query<{ r: boolean }>(`select public.is_business_owner($1) as r`, [a.businessId]),
    )
    const theirs = await as(db, 'authenticated', a.userId, () =>
      db.query<{ r: boolean }>(`select public.is_business_owner($1) as r`, [b.businessId]),
    )
    expect([mine.rows[0].r, theirs.rows[0].r]).toEqual([true, false])
  })
})

describe('logo storage', () => {
  const upload = (userId: string | null, role: 'anon' | 'authenticated', path: string) =>
    as(db, role, userId, () =>
      db.query(`insert into storage.objects (bucket_id, name) values ('logos', $1)`, [path]),
    )

  it('is a public bucket limited to 2 MB of png/jpeg/webp (no SVG)', async () => {
    const r = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'logos'`,
    )
    expect(r.rows[0].public).toBe(true)
    expect(Number(r.rows[0].file_size_limit)).toBe(2 * 1024 * 1024)
    expect(r.rows[0].allowed_mime_types).toEqual(['image/png', 'image/jpeg', 'image/webp'])
  })

  it("lets an owner upload into their own business folder", async () => {
    await expect(upload(a.userId, 'authenticated', `${a.businessId}/logo.png`)).resolves.toBeDefined()
  })

  it("blocks uploading into another business's folder", async () => {
    await expect(upload(a.userId, 'authenticated', `${b.businessId}/logo.png`)).rejects.toThrow(/row-level security/)
  })

  it('blocks uploads outside any business folder', async () => {
    await expect(upload(a.userId, 'authenticated', `logo.png`)).rejects.toThrow(/row-level security/)
    await expect(upload(a.userId, 'authenticated', `not-a-uuid/logo.png`)).rejects.toThrow(/row-level security/)
  })

  it('blocks anonymous uploads', async () => {
    await expect(upload(null, 'anon', `${a.businessId}/logo.png`)).rejects.toThrow(/row-level security/)
  })

  it("blocks replacing or deleting another business's logo", async () => {
    await db.query(`insert into storage.objects (bucket_id, name) values ('logos', $1)`, [`${b.businessId}/logo.png`])
    const upd = await as(db, 'authenticated', a.userId, () =>
      db.query(`update storage.objects set name = $1 where name = $2 returning id`, [`${a.businessId}/stolen.png`, `${b.businessId}/logo.png`]),
    )
    expect(upd.rows).toHaveLength(0)
    const del = await as(db, 'authenticated', a.userId, () =>
      db.query(`delete from storage.objects where name = $1 returning id`, [`${b.businessId}/logo.png`]),
    )
    expect(del.rows).toHaveLength(0)
  })
})
