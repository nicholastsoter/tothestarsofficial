// Date-range maths for the Analytics page. Everything works on plain "YYYY-MM-DD" strings that mean
// days in the BUSINESS's time zone, so nothing here depends on the browser's own zone or on daylight saving.

export type Preset = '7d' | '30d' | '90d' | 'all' | 'custom'
export type Bucket = 'day' | 'week' | 'month'
export interface DateRange { from: string; to: string }

const DAY_MS = 86_400_000
const DATE = /^\d{4}-\d{2}-\d{2}$/
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`)

export const isDate = (d: string) => DATE.test(d) && !Number.isNaN(toMs(d)) && new Date(toMs(d)).toISOString().slice(0, 10) === d

export function addDays(date: string, n: number): string {
  return new Date(toMs(date) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Whole days from a to b (b - a); negative if b is earlier. */
export const diffDays = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS)

/** Number of days in an inclusive range. */
export const rangeLength = (r: DateRange) => diffDays(r.from, r.to) + 1

export const PRESET_LABELS: Record<Preset, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All time', custom: 'Custom' }

/** The range a preset means "today" (in the business's zone). All time starts at the first day with data. */
export function presetRange(preset: Exclude<Preset, 'custom'>, today: string, firstDate: string | null): DateRange {
  if (preset === 'all') return { from: firstDate && firstDate <= today ? firstDate : today, to: today }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  return { from: addDays(today, -(days - 1)), to: today }
}

/** The same number of days immediately before this range. All time has no previous period. */
export function previousRange(r: DateRange, preset: Preset): DateRange | null {
  if (preset === 'all') return null
  const n = rangeLength(r)
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) }
}

/** Daily up to a month, weekly up to about four months, monthly beyond that. */
export function defaultBucket(r: DateRange): Bucket {
  const n = rangeLength(r)
  return n <= 31 ? 'day' : n <= 120 ? 'week' : 'month'
}

/** Buckets that would make a chart with too many or too few points. */
export function allowedBuckets(r: DateRange): Bucket[] {
  const n = rangeLength(r)
  return (['day', 'week', 'month'] as Bucket[]).filter((b) => (b === 'day' ? n <= 120 : b === 'week' ? n >= 7 && n <= 800 : n >= 28))
}

export function validateCustom(from: string, to: string, today: string): string | null {
  if (!isDate(from) || !isDate(to)) return 'Choose both dates.'
  if (from > to) return 'The start date must be on or before the end date.'
  if (to > today) return 'The end date can’t be in the future.'
  if (rangeLength({ from, to }) > 3650) return 'Please choose a range of 10 years or less.'
  return null
}

/** "Mar 9", "Mar 9" (week starting), "Mar 2025" for chart axes. Dates are labels, not instants, so UTC is used. */
export function formatBucket(date: string, bucket: Bucket): string {
  const d = new Date(toMs(date))
  return new Intl.DateTimeFormat('en-US', bucket === 'month' ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)
}

export function formatRange(r: DateRange): string {
  const f = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(toMs(d)))
  return r.from === r.to ? f(r.from) : `${f(r.from)} – ${f(r.to)}`
}
