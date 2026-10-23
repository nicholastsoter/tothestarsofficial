// CSV export for feedback. Two things matter here:
//  1. CSV injection: a cell that starts with = + - @ (or a tab/carriage return) can be run as a
//     formula when opened in Excel/Sheets. Customer text is untrusted, so such cells get a
//     leading apostrophe, which spreadsheets treat as "this is plain text".
//  2. Big exports mustn't freeze the page: rows are turned into text in small batches, with a
//     pause between batches so the browser can keep responding.

export interface ExportRow {
  created_at: string
  star_rating: number
  status: string
  message: string | null
  survey_answers: { prompt?: unknown; answer?: unknown }[]
  contact_name: string | null
  contact_email: string | null
}

const FORMULA_START = /^[=+\-@\t\r]/

/** Neutralises spreadsheet formulas. */
export function csvSafe(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}

/** One CSV cell: formula-safe, then quoted if it contains a comma, quote or line break. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const safe = csvSafe(text)
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',')

/** "2026-03-01 23:00:00" in the given IANA time zone (the business's own), so dates match the inbox. */
export function formatTimestamp(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

const answerText = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/** Survey questions seen across all rows, in order of first appearance, become columns. */
export function questionColumns(rows: ExportRow[]): string[] {
  const seen = new Set<string>()
  for (const r of rows) for (const a of r.survey_answers) if (typeof a.prompt === 'string') seen.add(a.prompt)
  return [...seen]
}

export function csvHeader(questions: string[]): string {
  return csvLine(['Date', 'Stars', 'Status', 'Message', ...questions, 'Contact name', 'Contact email'])
}

export function csvRow(r: ExportRow, questions: string[], timeZone: string): string {
  const byPrompt = new Map<string, string>()
  for (const a of r.survey_answers) if (typeof a.prompt === 'string') byPrompt.set(a.prompt, answerText(a.answer))
  return csvLine([
    formatTimestamp(r.created_at, timeZone),
    r.star_rating,
    r.status,
    r.message ?? '',
    ...questions.map((q) => byPrompt.get(q) ?? ''),
    r.contact_name ?? '', // the database only stores these when the customer opted in
    r.contact_email ?? '',
  ])
}

const BATCH = 500
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Builds the whole CSV as a Blob (with a BOM so Excel reads UTF-8), yielding between batches. */
export async function buildCsvBlob(rows: ExportRow[], timeZone: string, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const questions = questionColumns(rows)
  const parts: string[] = ['\uFEFF', csvHeader(questions), '\r\n']
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    parts.push(chunk.map((r) => csvRow(r, questions, timeZone)).join('\r\n'), '\r\n')
    onProgress?.(Math.min(i + BATCH, rows.length), rows.length)
    await pause()
  }
  return new Blob(parts, { type: 'text/csv;charset=utf-8' })
}
