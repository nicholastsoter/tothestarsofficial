import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, createDb, createTenant, seedFeedback, type Tenant } from './helpers'

let db: PGlite
let a: Tenant
let b: Tenant
let aFeedback: string // 4 stars, with a message
let aBare: string // 5 stars, star tap only
let bFeedback: string

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
  aFeedback = await seedFeedback(db, a.businessId, 4, 'Great coffee')
  aBare = await seedFeedback(db, a.businessId, 5)
  bFeedback = await seedFeedback(db, b.businessId, 2, 'Slow service')
  await as(db, 'service_role', null, () =>
    db.query(`insert into public.feedback_secrets (feedback_id, token_hash) values ($1, repeat('ab', 32))`, [aFeedback]),
  )
  await as(db, 'service_role', null, () =>
    db.query(`insert into public.events (business_id, type, star_rating) values ($1, 'star_click', 4), ($2, 'page_view', null)`, [
      a.businessId,
      b.businessId,
    ]),
  )
})

const asA = <T>(fn: () => Promise<T>) => as(db, 'authenticated', a.userId, fn)

describe('feedback: reading', () => {
  it("shows an owner only their own feedback, never another business's", async () => {
    const r = await asA(() => db.query<{ id: string }>(`select id from public.feedback`))
    expect(r.rows.map((x) => x.id).sort()).toEqual([aFeedback, aBare].sort())
    expect(r.rows.map((x) => x.id)).not.toContain(bFeedback)
  })

  it('flags star-only rows as having no content, so the inbox can hide them', async () => {
    const inbox = await asA(() =>
      db.query<{ id: string }>(`select id from public.feedback where has_content`),
    )
    expect(inbox.rows.map((x) => x.id)).toEqual([aFeedback])

    // analytics still see every row
    const all = await asA(() => db.query<{ n: number }>(`select count(*)::int as n from public.feedback`))
    expect(all.rows[0].n).toBe(2)
  })

  it('treats survey answers (without a message) as content', async () => {
    const id = await seedFeedback(db, a.businessId, 2)
    await as(db, 'service_role', null, () =>
      db.query(`update public.feedback set survey_answers = '[{"prompt":"Why?","answer":"Late"}]' where id = $1`, [id]),
    )
    const r = await asA(() => db.query<{ has_content: boolean }>(`select has_content from public.feedback where id = $1`, [id]))
    expect(r.rows[0].has_content).toBe(true)
  })

  it('treats a whitespace-only message as no content', async () => {
    const id = await seedFeedback(db, a.businessId, 3, '   ')
    const r = await asA(() => db.query<{ has_content: boolean }>(`select has_content from public.feedback where id = $1`, [id]))
    expect(r.rows[0].has_content).toBe(false)
  })

  it('never exposes the visitor edit-token table to an owner', async () => {
    await expect(asA(() => db.query(`select * from public.feedback_secrets`))).rejects.toThrow(/permission denied/)
  })
})

describe('feedback: owners can only triage, not rewrite', () => {
  it('can mark feedback resolved and write a private note', async () => {
    const r = await asA(() =>
      db.query<{ status: string; private_note: string }>(
        `update public.feedback set status = 'resolved', private_note = 'Called them back' where id = $1
         returning status, private_note`,
        [aFeedback],
      ),
    )
    expect(r.rows[0]).toEqual({ status: 'resolved', private_note: 'Called them back' })
  })

  it('cannot edit the star rating', async () => {
    await expect(
      asA(() => db.query(`update public.feedback set star_rating = 5 where id = $1`, [aFeedback])),
    ).rejects.toThrow(/permission denied/)
  })

  it('cannot edit the customer message', async () => {
    await expect(
      asA(() => db.query(`update public.feedback set message = 'Rewritten' where id = $1`, [aFeedback])),
    ).rejects.toThrow(/permission denied/)
  })

  it('cannot edit survey answers, contact details, or move feedback to another business', async () => {
    for (const set of [`survey_answers = '[]'`, `contact_name = 'x'`, `contact_email = 'x@y.z'`, `business_id = '${b.businessId}'`, `created_at = now()`]) {
      await expect(asA(() => db.query(`update public.feedback set ${set} where id = $1`, [aFeedback])), set).rejects.toThrow(
        /permission denied/,
      )
    }
    const row = await db.query<{ star_rating: number; message: string }>(
      `select star_rating, message from public.feedback where id = $1`,
      [aFeedback],
    )
    expect(row.rows[0]).toEqual({ star_rating: 4, message: 'Great coffee' })
  })

  it("cannot triage another business's feedback (0 rows touched)", async () => {
    const r = await asA(() =>
      db.query(`update public.feedback set status = 'resolved', private_note = 'mine now' where id = $1 returning id`, [bFeedback]),
    )
    expect(r.rows).toHaveLength(0)
    const row = await db.query<{ status: string }>(`select status from public.feedback where id = $1`, [bFeedback])
    expect(row.rows[0].status).toBe('new')
  })

  it("cannot delete another business's feedback", async () => {
    const r = await asA(() => db.query(`delete from public.feedback where id = $1 returning id`, [bFeedback]))
    expect(r.rows).toHaveLength(0)
  })

  it('cannot create feedback at all (only the submit-public function can)', async () => {
    await expect(
      asA(() => db.query(`insert into public.feedback (business_id, star_rating) values ($1, 5)`, [a.businessId])),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asA(() => db.query(`insert into public.feedback (business_id, star_rating) values ($1, 5)`, [b.businessId])),
    ).rejects.toThrow(/permission denied/)
  })

  it('cannot create feedback anonymously', async () => {
    await expect(
      as(db, 'anon', null, () => db.query(`insert into public.feedback (business_id, star_rating) values ($1, 5)`, [a.businessId])),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('feedback: data rules', () => {
  const insert = (cols: string, vals: unknown[], ph: string) =>
    as(db, 'service_role', null, () =>
      db.query(`insert into public.feedback (business_id, ${cols}) values ($1, ${ph})`, [a.businessId, ...vals]),
    )

  it('rejects star ratings outside 1-5', async () => {
    await expect(insert('star_rating', [6], '$2')).rejects.toThrow(/check constraint/)
    await expect(insert('star_rating', [0], '$2')).rejects.toThrow(/check constraint/)
  })

  it('refuses a contact email without explicit consent', async () => {
    await expect(insert('star_rating, contact_email', [3, 'a@b.co'], '$2, $3')).rejects.toThrow(/check constraint/)
    await expect(insert('star_rating, contact_email, contact_consent', [3, 'a@b.co', true], '$2, $3, $4')).resolves.toBeDefined()
  })

  it('rejects survey answers that are not a JSON array', async () => {
    await expect(insert('star_rating, survey_answers', [3, '{"a":1}'], '$2, $3')).rejects.toThrow(/check constraint/)
  })
})

describe('events', () => {
  it('lets an owner read only their own events', async () => {
    const r = await asA(() => db.query<{ type: string }>(`select type from public.events`))
    expect(r.rows.map((x) => x.type)).toEqual(['star_click'])
  })

  it('cannot be written, edited or deleted by an owner', async () => {
    await expect(
      asA(() => db.query(`insert into public.events (business_id, type) values ($1, 'page_view')`, [a.businessId])),
    ).rejects.toThrow(/permission denied/)
    await expect(asA(() => db.query(`update public.events set type = 'page_view'`))).rejects.toThrow(/permission denied/)
    await expect(asA(() => db.query(`delete from public.events`))).rejects.toThrow(/permission denied/)
  })

  it('cannot be forged by anonymous visitors directly', async () => {
    await expect(
      as(db, 'anon', null, () => db.query(`insert into public.events (business_id, type) values ($1, 'page_view')`, [a.businessId])),
    ).rejects.toThrow(/permission denied/)
  })
})
