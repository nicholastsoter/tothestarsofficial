import { describe, expect, it, vi } from 'vitest'
import { buildCsvBlob, csvCell, csvHeader, csvRow, csvSafe, formatTimestamp, questionColumns, type ExportRow } from './csv'
import { MAX_QUESTIONS, pruneAnswers, validateQuestionDraft, type PublicQuestion } from './survey'

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  created_at: '2026-03-01T10:00:00Z', star_rating: 2, status: 'new', message: 'Cold food', survey_answers: [], contact_name: null, contact_email: null, ...over,
})

describe('CSV injection defense', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1', "=cmd|' /C calc'!A0", '=HYPERLINK("http://evil","click")', '-2+3', '+cmd'])(
    'neutralises a cell starting with %j',
    (text) => {
      expect(csvSafe(text)).toBe(`'${text}`)
      expect(csvCell(text).replace(/^"/, '')).toMatch(/^'/)
    },
  )

  it.each(['Great food', 'It was 5 - 6 stars', 'a=b', 'email me @ home', ' =leading space is not a formula start', "'already quoted", '100%'])('leaves normal text alone: %j', (text) => {
    expect(csvSafe(text)).toBe(text)
  })

  it('applies to every customer-controlled column: message, answers, contact name and email, and question headers', () => {
    const r = row({
      message: '=EVIL()',
      survey_answers: [{ prompt: '=PROMPT()', answer: '+ANSWER()' }],
      contact_name: '@NAME',
      contact_email: '-mail@x.com',
    })
    const q = questionColumns([r])
    const csv = `${csvHeader(q)}\r\n${csvRow(r, q, 'UTC')}`
    for (const evil of ['=EVIL()', '=PROMPT()', '+ANSWER()', '@NAME', '-mail@x.com']) {
      expect(csv).toContain(`'${evil}`)
      expect(csv).not.toMatch(new RegExp(`(^|,|\\r\\n)${evil.replace(/[()+@\-=.]/g, '\\$&')}`))
    }
  })

  it('still quotes commas, quotes and line breaks correctly', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell('=SUM(A1,A2)')).toBe(`"'=SUM(A1,A2)"`)
    expect(csvCell(null)).toBe('')
    expect(csvCell(4)).toBe('4')
  })
})

describe('CSV content', () => {
  it('has date, stars, status, message, each survey question as a column, and opted-in contact info', () => {
    const rows = [
      row({ survey_answers: [{ prompt: 'What fell short?', answer: 'Wait time' }, { prompt: 'Cleanliness?', answer: 3 }], contact_name: 'Sam', contact_email: 'sam@example.com' }),
      row({ message: null, survey_answers: [{ prompt: 'Cleanliness?', answer: 5 }], star_rating: 1 }),
    ]
    const q = questionColumns(rows)
    expect(q).toEqual(['What fell short?', 'Cleanliness?'])
    expect(csvHeader(q)).toBe('Date,Stars,Status,Message,What fell short?,Cleanliness?,Contact name,Contact email')
    expect(csvRow(rows[0], q, 'UTC')).toBe('2026-03-01 10:00:00,2,new,Cold food,Wait time,3,Sam,sam@example.com')
    expect(csvRow(rows[1], q, 'UTC')).toBe('2026-03-01 10:00:00,1,new,,,5,,')
  })

  it('formats dates in the business time zone', () => {
    expect(formatTimestamp('2026-03-01T10:00:00Z', 'Pacific/Auckland')).toBe('2026-03-01 23:00:00')
    expect(formatTimestamp('2026-03-01T10:00:00Z', 'America/Chicago')).toBe('2026-03-01 04:00:00')
    expect(formatTimestamp('2026-03-01T10:00:00Z', 'Not/AZone')).toBe('2026-03-01T10:00:00Z')
  })

  it('keeps old responses readable using their snapshotted question text', () => {
    const old = row({ survey_answers: [{ prompt: 'A question that no longer exists', answer: 'still here' }] })
    expect(csvRow(old, questionColumns([old]), 'UTC')).toContain('still here')
  })
})

describe('large exports', () => {
  it('builds 5,000 rows in batches, pausing between them so the page stays responsive', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row({ message: `Message ${i}` }))
    const spy = vi.spyOn(globalThis, 'setTimeout')
    const progress: number[] = []
    const blob = await buildCsvBlob(rows, 'UTC', (done) => progress.push(done))
    const pauses = spy.mock.calls.filter((c) => c[1] === 0).length
    spy.mockRestore()
    expect(pauses).toBeGreaterThanOrEqual(10)
    expect(progress.at(-1)).toBe(5000)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 byte-order mark so Excel reads accents correctly
    const text = await blob.text() // decoding drops the BOM
    expect(text.startsWith('Date,Stars')).toBe(true)
    expect(text.trim().split('\r\n')).toHaveLength(5001)
    expect(blob.type).toContain('text/csv')
  })

  it('handles an empty export (header only)', async () => {
    const text = await (await buildCsvBlob([], 'UTC')).text()
    expect(text).toBe('Date,Stars,Status,Message,Contact name,Contact email\r\n')
  })
})

describe('question editor validation', () => {
  const d = (over = {}) => ({ type: 'short_text' as const, prompt: 'How was it?', options: [] as string[], required: false, ...over })
  it('accepts valid drafts', () => {
    expect(validateQuestionDraft(d())).toBeNull()
    expect(validateQuestionDraft(d({ type: 'multiple_choice', options: ['a', 'b'] }))).toBeNull()
  })
  it.each([
    [{ prompt: '   ' }, /Write the question/],
    [{ prompt: 'x'.repeat(301) }, /under 300/],
    [{ type: 'multiple_choice', options: ['only one'] }, /at least 2/],
    [{ type: 'multiple_choice', options: ['a', ''] }, /empty option/],
    [{ type: 'multiple_choice', options: ['a', 'a'] }, /different/],
    [{ type: 'multiple_choice', options: ['a', 'x'.repeat(101)] }, /100 characters/],
    [{ type: 'multiple_choice', options: Array.from({ length: 11 }, (_, i) => `o${i}`) }, /at most 10/],
  ])('rejects %j', (over, msg) => {
    expect(validateQuestionDraft(d(over))).toMatch(msg)
  })
  it('knows the question limit', () => expect(MAX_QUESTIONS).toBe(10))
})

describe('pruneAnswers (survey edited mid-visit)', () => {
  const qs: PublicQuestion[] = [
    { id: 'a', type: 'multiple_choice', prompt: 'A', options: ['x', 'y'], required: false },
    { id: 'b', type: 'long_text', prompt: 'B', options: null, required: false },
    { id: 'c', type: 'rating', prompt: 'C', options: null, required: false },
  ]
  it('keeps answers that still fit and drops the rest', () => {
    expect(pruneAnswers(qs, { a: 'x', b: 'text', c: 4, gone: 'old' })).toEqual({ answers: { a: 'x', b: 'text', c: 4 }, dropped: 1 })
  })
  it('drops a multiple-choice answer whose option was removed, and wrong-typed values', () => {
    expect(pruneAnswers(qs, { a: 'removed option', b: 5, c: 'four' })).toEqual({ answers: {}, dropped: 3 })
  })
  it('handles an emptied survey', () => {
    expect(pruneAnswers([], { a: 'x', b: 'y' })).toEqual({ answers: {}, dropped: 2 })
  })
})
