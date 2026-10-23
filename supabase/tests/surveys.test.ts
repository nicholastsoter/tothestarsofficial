import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { as, createDb, createTenant, type Tenant } from './helpers'

let db: PGlite
let a: Tenant
let b: Tenant
let aSurvey: string
let bSurvey: string

beforeAll(async () => {
  db = await createDb()
  a = await createTenant(db, 'Alpha Cafe', 'alpha-cafe')
  b = await createTenant(db, 'Bravo Bakery', 'bravo-bakery')
  const s = await db.query<{ id: string; business_id: string }>(`select id, business_id from public.surveys`)
  aSurvey = s.rows.find((r) => r.business_id === a.businessId)!.id
  bSurvey = s.rows.find((r) => r.business_id === b.businessId)!.id
})

const asA = <T>(fn: () => Promise<T>) => as(db, 'authenticated', a.userId, fn)
const addQuestion = (survey: string, business: string, position: number, type = 'short_text', options: string | null = null) =>
  asA(() =>
    db.query(
      `insert into public.survey_questions (survey_id, business_id, position, type, prompt, options)
       values ($1, $2, $3, $4, 'Q?', $5)`,
      [survey, business, position, type, options],
    ),
  )

describe('surveys', () => {
  it('creates one survey with starter questions for each new business', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.survey_questions where business_id = $1`,
      [a.businessId],
    )
    expect(r.rows[0].n).toBe(2)
  })

  it('shows an owner only their own survey and questions', async () => {
    const s = await asA(() => db.query<{ id: string }>(`select id from public.surveys`))
    expect(s.rows.map((x) => x.id)).toEqual([aSurvey])
    const q = await asA(() => db.query<{ business_id: string }>(`select business_id from public.survey_questions`))
    expect(new Set(q.rows.map((x) => x.business_id))).toEqual(new Set([a.businessId]))
  })

  it('cannot create or delete surveys directly', async () => {
    await expect(asA(() => db.query(`insert into public.surveys (business_id) values ($1)`, [a.businessId]))).rejects.toThrow(
      /permission denied/,
    )
    await expect(asA(() => db.query(`delete from public.surveys`))).rejects.toThrow(/permission denied/)
  })

  it("cannot switch another business's survey off", async () => {
    const r = await asA(() => db.query(`update public.surveys set enabled = false where id = $1 returning id`, [bSurvey]))
    expect(r.rows).toHaveLength(0)
  })
})

describe('survey questions: tenant isolation', () => {
  it("cannot add a question to another business's survey", async () => {
    await expect(addQuestion(bSurvey, b.businessId, 9)).rejects.toThrow(/row-level security/)
  })

  it("cannot sneak a question into another survey by lying about business_id", async () => {
    await expect(addQuestion(bSurvey, a.businessId, 9)).rejects.toThrow(/foreign key/)
  })

  it("cannot edit or delete another business's questions", async () => {
    const upd = await asA(() => db.query(`update public.survey_questions set prompt = 'Hacked' where business_id = $1 returning id`, [b.businessId]))
    expect(upd.rows).toHaveLength(0)
    const del = await asA(() => db.query(`delete from public.survey_questions where business_id = $1 returning id`, [b.businessId]))
    expect(del.rows).toHaveLength(0)
  })

  it('cannot move its own question into another business', async () => {
    await expect(
      asA(() => db.query(`update public.survey_questions set business_id = $1, survey_id = $2 where business_id = $3`, [b.businessId, bSurvey, a.businessId])),
    ).rejects.toThrow(/row-level security/)
  })

  it('cannot read questions anonymously except through the public function', async () => {
    await expect(as(db, 'anon', null, () => db.query(`select * from public.survey_questions`))).rejects.toThrow(/permission denied/)
  })
})

describe('survey questions: editing', () => {
  it('adds, edits, and deletes its own questions', async () => {
    await addQuestion(aSurvey, a.businessId, 5)
    const upd = await asA(() => db.query(`update public.survey_questions set prompt = 'Edited' where survey_id = $1 and position = 5 returning prompt`, [aSurvey]))
    expect(upd.rows[0]).toEqual({ prompt: 'Edited' })
    const del = await asA(() => db.query(`delete from public.survey_questions where survey_id = $1 and position = 5 returning id`, [aSurvey]))
    expect(del.rows).toHaveLength(1)
  })

  it('can swap two positions in one transaction (reordering)', async () => {
    const before = await asA(() => db.query<{ id: string; position: number }>(`select id, position from public.survey_questions where survey_id = $1 order by position`, [aSurvey]))
    const [first, second] = before.rows
    await as(db, 'authenticated', a.userId, async () => {
      await db.exec('begin')
      await db.query(`update public.survey_questions set position = $1 where id = $2`, [second.position, first.id])
      await db.query(`update public.survey_questions set position = $1 where id = $2`, [first.position, second.id])
      await db.exec('commit')
    })
    const after = await asA(() => db.query<{ id: string }>(`select id from public.survey_questions where survey_id = $1 order by position`, [aSurvey]))
    expect(after.rows.map((r) => r.id)).toEqual([second.id, first.id])
  })

  it('requires 2-10 options for multiple choice and none for other types', async () => {
    await expect(addQuestion(aSurvey, a.businessId, 20, 'multiple_choice', null)).rejects.toThrow(/check constraint/)
    await expect(addQuestion(aSurvey, a.businessId, 21, 'multiple_choice', '["only one"]')).rejects.toThrow(/check constraint/)
    await expect(addQuestion(aSurvey, a.businessId, 22, 'short_text', '["a","b"]')).rejects.toThrow(/check constraint/)
    await expect(addQuestion(aSurvey, a.businessId, 23, 'multiple_choice', '["a","b"]')).resolves.toBeDefined()
  })
})
