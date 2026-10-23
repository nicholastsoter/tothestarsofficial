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

const asA = <T>(fn: () => Promise<T>) => as(db, 'authenticated', a.userId, fn)

describe('every table is protected', () => {
  it('has RLS enabled on every table in the public schema', async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    )
    expect(r.rows).toEqual([])
  })

  it('gives anonymous visitors no table access at all', async () => {
    for (const t of ['businesses', 'slug_history', 'surveys', 'survey_questions', 'feedback', 'feedback_secrets', 'events', 'rate_limits']) {
      await expect(
        as(db, 'anon', null, () => db.query(`select * from public.${t}`)),
      ).rejects.toThrow(/permission denied/)
    }
  })
})

describe('businesses', () => {
  it('lets an owner see only their own business', async () => {
    const r = await asA(() => db.query<{ id: string }>(`select id from public.businesses`))
    expect(r.rows.map((x) => x.id)).toEqual([a.businessId])
  })

  it("cannot update another owner's business (0 rows touched)", async () => {
    const r = await asA(() =>
      db.query(`update public.businesses set name = 'Hacked' where id = $1 returning id`, [b.businessId]),
    )
    expect(r.rows).toHaveLength(0)
    const check = await db.query<{ name: string }>(`select name from public.businesses where id = $1`, [b.businessId])
    expect(check.rows[0].name).toBe('Bravo Bakery')
  })

  it("cannot delete another owner's business", async () => {
    const r = await asA(() => db.query(`delete from public.businesses where id = $1 returning id`, [b.businessId]))
    expect(r.rows).toHaveLength(0)
  })

  it('cannot create a business owned by someone else', async () => {
    await expect(
      asA(() =>
        db.query(
          `insert into public.businesses (owner_user_id, name, slug, timezone)
           values ($1, 'Fake', 'fake-biz', 'UTC')`,
          [b.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('cannot hand their business to another user', async () => {
    await expect(
      asA(() => db.query(`update public.businesses set owner_user_id = $1 where id = $2`, [b.userId, a.businessId])),
    ).rejects.toThrow(/permission denied/)
  })

  it('cannot change their business id', async () => {
    await expect(
      asA(() => db.query(`update public.businesses set id = gen_random_uuid() where id = $1`, [a.businessId])),
    ).rejects.toThrow(/permission denied/)
  })

  it('is limited to one business per account', async () => {
    await expect(
      asA(() =>
        db.query(
          `insert into public.businesses (owner_user_id, name, slug, timezone)
           values ($1, 'Second', 'second-biz', 'UTC')`,
          [a.userId],
        ),
      ),
    ).rejects.toThrow(/duplicate key/)
  })
})

describe('business field validation', () => {
  const update = (set: string, value: string) =>
    asA(() => db.query(`update public.businesses set ${set} = $1 where id = $2`, [value, a.businessId]))

  it.each(['admin', 'api', 'login', 'signup', 'r', 'settings'])('rejects reserved slug "%s"', async (slug) => {
    await expect(update('slug', slug)).rejects.toThrow(/check constraint/)
  })

  it.each(['Has Caps', 'has_underscore', '-leading', 'trailing-', 'double--dash', 'ab'])(
    'rejects malformed slug "%s"',
    async (slug) => {
      await expect(update('slug', slug)).rejects.toThrow(/check constraint/)
    },
  )

  it('rejects an invalid time zone', async () => {
    await expect(update('timezone', 'Mars/Olympus')).rejects.toThrow(/check constraint/)
  })

  it('accepts a real time zone', async () => {
    await expect(update('timezone', 'Europe/London')).resolves.toBeDefined()
  })

  it('rejects a Place ID containing URL-breaking characters', async () => {
    await expect(update('place_id', 'abc&redirect=evil.com/xxxx')).rejects.toThrow(/check constraint/)
  })

  it('rejects a non-hex brand colour', async () => {
    await expect(update('brand_color', 'red')).rejects.toThrow(/check constraint/)
  })

  it('rejects a non-https logo URL', async () => {
    await expect(update('logo_url', 'javascript:alert(1)')).rejects.toThrow(/check constraint/)
  })
})

describe('slug history and redirects', () => {
  let c: Tenant
  let d: Tenant
  beforeAll(async () => {
    c = await createTenant(db, 'Charlie Cuts', 'charlie-cuts')
    d = await createTenant(db, 'Delta Deli', 'delta-deli')
  })
  const asC = <T>(fn: () => Promise<T>) => as(db, 'authenticated', c.userId, fn)
  const rename = (slug: string) =>
    asC(() => db.query(`update public.businesses set slug = $1 where id = $2`, [slug, c.businessId]))

  it('keeps the old slug and the public page redirects to the new one', async () => {
    await rename('charlie-barber')
    const r = await as(db, 'anon', null, () =>
      db.query<{ p: { slug: string } }>(`select public.get_public_review_page('charlie-cuts') as p`),
    )
    expect(r.rows[0].p.slug).toBe('charlie-barber')
  })

  it("blocks another business from taking someone's old slug", async () => {
    await expect(
      as(db, 'authenticated', d.userId, () =>
        db.query(`update public.businesses set slug = 'charlie-cuts' where id = $1`, [d.businessId]),
      ),
    ).rejects.toThrow(/already taken/)
  })

  it('lets the original owner take their old slug back', async () => {
    await rename('charlie-cuts')
    const r = await as(db, 'anon', null, () =>
      db.query<{ p: { slug: string } }>(`select public.get_public_review_page('charlie-cuts') as p`),
    )
    expect(r.rows[0].p.slug).toBe('charlie-cuts')
  })

  it('shows an owner only their own history, read-only', async () => {
    await rename('charlie-two')
    const mine = await asC(() => db.query<{ slug: string }>(`select slug from public.slug_history`))
    expect(mine.rows.map((x) => x.slug)).toContain('charlie-cuts')
    const dees = await as(db, 'authenticated', d.userId, () => db.query(`select slug from public.slug_history`))
    expect(dees.rows).toHaveLength(0)
    await expect(
      asC(() => db.query(`insert into public.slug_history (slug, business_id) values ('sneaky-slug', $1)`, [c.businessId])),
    ).rejects.toThrow(/permission denied/)
  })

  it('caps how many times a slug can be changed', async () => {
    let failure: unknown
    for (let i = 0; i < 12 && !failure; i++) {
      try {
        await rename(`churn-slug-${i}`)
      } catch (e) {
        failure = e
      }
    }
    expect(String(failure)).toMatch(/too many times/)
  })
})

describe('public review page function', () => {
  it('returns only whitelisted fields to an anonymous visitor', async () => {
    const r = await as(db, 'anon', null, () =>
      db.query<{ p: Record<string, unknown> }>(`select public.get_public_review_page('alpha-cafe') as p`),
    )
    const page = r.rows[0].p
    expect(Object.keys(page).sort()).toEqual(
      ['brand_color', 'logo_url', 'name', 'place_id', 'questions', 'slug', 'thank_you_message'].sort(),
    )
    expect(JSON.stringify(page)).not.toContain(a.userId)
  })

  it('returns null for an unknown slug', async () => {
    const r = await as(db, 'anon', null, () =>
      db.query<{ p: unknown }>(`select public.get_public_review_page('nope-nope') as p`),
    )
    expect(r.rows[0].p).toBeNull()
  })

  it('returns the survey questions in order, and none when the survey is switched off', async () => {
    const on = await as(db, 'anon', null, () =>
      db.query<{ p: { questions: { prompt: string }[] } }>(`select public.get_public_review_page('alpha-cafe') as p`),
    )
    expect(on.rows[0].p.questions).toHaveLength(2)
    expect(on.rows[0].p.questions[0].prompt).toMatch(/fell short/)

    await asA(() => db.query(`update public.surveys set enabled = false where business_id = $1`, [a.businessId]))
    const off = await as(db, 'anon', null, () =>
      db.query<{ p: { questions: unknown[] } }>(`select public.get_public_review_page('alpha-cafe') as p`),
    )
    expect(off.rows[0].p.questions).toEqual([])
    await asA(() => db.query(`update public.surveys set enabled = true where business_id = $1`, [a.businessId]))
  })
})

describe('account deletion', () => {
  it('removes the business and everything under it when the auth user is deleted', async () => {
    const z = await createTenant(db, 'Zulu Zoo', 'zulu-zoo')
    await db.query(`insert into public.feedback (business_id, star_rating) values ($1, 5)`, [z.businessId])
    await db.query(`insert into public.events (business_id, type) values ($1, 'page_view')`, [z.businessId])
    await db.query(`delete from auth.users where id = $1`, [z.userId])
    for (const t of ['businesses', 'surveys', 'survey_questions', 'feedback', 'events']) {
      const col = t === 'businesses' ? 'id' : 'business_id'
      const r = await db.query(`select 1 from public.${t} where ${col} = $1`, [z.businessId])
      expect(r.rows, t).toHaveLength(0)
    }
  })
})
