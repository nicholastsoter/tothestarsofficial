import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dirname

export type Role = 'anon' | 'authenticated' | 'service_role'

/** A fresh in-memory Postgres with the bootstrap stub and every real migration applied. */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(join(here, 'bootstrap.sql'), 'utf8'))
  const dir = join(here, '..', 'migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'))
  }
  return db
}

/** Run `fn` while acting as the given database role (and user, for authenticated). */
export async function as<T>(
  db: PGlite,
  role: Role,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify(userId ? { sub: userId, role } : { role }),
  ])
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

export interface Tenant {
  userId: string
  businessId: string
  slug: string
}

/** Create an auth user, then their business *as that user* (so the insert policy is exercised). */
export async function createTenant(db: PGlite, name: string, slug: string): Promise<Tenant> {
  const user = await db.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${slug}@example.com`],
  )
  const userId = user.rows[0].id
  const biz = await as(db, 'authenticated', userId, () =>
    db.query<{ id: string }>(
      `insert into public.businesses (owner_user_id, name, slug, timezone)
       values ($1, $2, $3, 'America/Chicago') returning id`,
      [userId, name, slug],
    ),
  )
  return { userId, businessId: biz.rows[0].id, slug }
}

/** Insert a feedback row as the service role (the way the submit-public Edge Function does). */
export async function seedFeedback(
  db: PGlite,
  businessId: string,
  stars: number,
  message: string | null = null,
): Promise<string> {
  const r = await as(db, 'service_role', null, () =>
    db.query<{ id: string }>(
      `insert into public.feedback (business_id, star_rating, message)
       values ($1, $2, $3) returning id`,
      [businessId, stars, message],
    ),
  )
  return r.rows[0].id
}

/** An Rpc that runs the Postgres function in the test database as the service role, the same
 *  way the Edge Function's REST call does in production. */
export function pgRpc(db: PGlite) {
  return async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const keys = Object.keys(args)
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`
    const values = keys.map((k) => {
      const v = args[k]
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
    })
    const res = await as(db, 'service_role', null, () => db.query<{ r: unknown }>(sql, values))
    return res.rows[0].r
  }
}

/** Every text value in every public table, for "this string must not be stored anywhere" checks. */
export async function dbContains(db: PGlite, needle: string): Promise<boolean> {
  const tables = await db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`,
  )
  for (const t of tables.rows) {
    const r = await db.query<{ hit: boolean }>(`select exists (select 1 from public."${t.relname}" x where x::text like $1) as hit`, [`%${needle}%`])
    if (r.rows[0].hit) return true
  }
  return false
}
