// Trend arrows and number formatting for the KPI cards. The honesty rule lives here: with fewer than
// 5 ratings in either period we show the number but never an arrow, and say why.

export const MIN_RATINGS_FOR_TREND = 5
export const SMALL_SAMPLE_NOTE = 'Too few ratings to call a trend (we need at least 5 in each period).'

export interface Trend {
  direction: 'up' | 'down' | 'flat' | 'none'
  /** e.g. "+12%", "+0.3", "-1.5 pts" */
  label: string
  /** why there is no arrow, when direction is 'none' */
  reason?: string
}

interface Opts {
  kind: 'count' | 'average' | 'rate'
  /** ratings collected in each period: the sample the whole comparison rests on */
  curRatings: number
  prevRatings: number | null
}

const NONE: Trend = { direction: 'none', label: '' }

export function trend(cur: number | null, prev: number | null, o: Opts): Trend {
  if (o.prevRatings === null) return { ...NONE, reason: 'There is no earlier period to compare with.' }
  if (Math.min(o.curRatings, o.prevRatings) < MIN_RATINGS_FOR_TREND) return { ...NONE, reason: SMALL_SAMPLE_NOTE }
  if (cur === null || prev === null) return { ...NONE, reason: 'Not enough data in one of the periods.' }

  if (o.kind === 'average') {
    const diff = Math.round((cur - prev) * 100) / 100
    if (Math.abs(diff) < 0.05) return { direction: 'flat', label: 'no change' }
    return { direction: diff > 0 ? 'up' : 'down', label: `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)}` }
  }
  if (o.kind === 'rate') {
    const pts = Math.round((cur - prev) * 1000) / 10 // rates are 0..1; show percentage points
    if (Math.abs(pts) < 0.5) return { direction: 'flat', label: 'no change' }
    return { direction: pts > 0 ? 'up' : 'down', label: `${pts > 0 ? '+' : '−'}${Math.abs(pts).toFixed(1)} pts` }
  }
  if (prev === 0) return cur === 0 ? { direction: 'flat', label: 'no change' } : { direction: 'up', label: 'up from 0' }
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return { direction: 'flat', label: 'no change' }
  return { direction: pct > 0 ? 'up' : 'down', label: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` }
}

/** Google clicks divided by page views. null when there were no page views. */
export const clickThroughRate = (clicks: number, views: number): number | null => (views > 0 ? clicks / views : null)

export const formatInt = (n: number) => new Intl.NumberFormat('en-US').format(n)
export const formatAvg = (n: number | null, digits = 1) => (n === null ? '–' : n.toFixed(digits))
export const formatPercent = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(r >= 0.1 ? 0 : 1)}%`)

/** Progress toward a goal as 0..1 (average / goal), capped at 1. */
export function goalProgress(avg: number | null, goal: number | null): number | null {
  if (avg === null || goal === null || goal <= 0) return null
  return Math.min(1, Math.max(0, avg / goal))
}

/** 1.0 to 5.0 with at most one decimal; '' means "no goal". Returns the number, null for none, or an error string. */
export function parseGoal(input: string): { value: number | null } | { error: string } {
  const t = input.trim()
  if (t === '') return { value: null }
  if (!/^\d(\.\d)?$/.test(t)) return { error: 'Enter a number from 1.0 to 5.0 (one decimal place).' }
  const n = Number(t)
  if (n < 1 || n > 5) return { error: 'Enter a number from 1.0 to 5.0.' }
  return { value: n }
}
