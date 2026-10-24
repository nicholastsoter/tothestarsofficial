// Logic shared by the dashboard Overview and the Analytics page, so both always show the same numbers
// for the same range: which range the URL means, the trend arrows, and the one-sentence summary.
import { rangeLength, type DateRange, type Preset } from './ranges'
import { MIN_RATINGS_FOR_TREND, clickThroughRate, trend, type Trend } from './trend'
import type { Summary } from './api'

/** The ranges the Overview offers. Analytics also accepts 'custom'. */
export const OVERVIEW_PRESETS = ['7d', '30d', '90d', 'all'] as const
export type OverviewPreset = (typeof OVERVIEW_PRESETS)[number]
export const DEFAULT_PRESET: OverviewPreset = '30d'

const isOverview = (v: string | null): v is OverviewPreset => !!v && (OVERVIEW_PRESETS as readonly string[]).includes(v)

/** The range in the URL (?range=7d). Anything missing or unrecognised falls back to 30 days. Never browser storage. */
export function presetFromSearch(search: string): OverviewPreset {
  const v = new URLSearchParams(search).get('range')
  return isOverview(v) ? v : DEFAULT_PRESET
}

/** Analytics reads the same parameter, plus ?range=custom&from=&to= . ?range=custom alone opens the date picker; invalid custom dates fall back to 30 days. */
export function analyticsStateFromSearch(search: string, isValidCustom: (from: string, to: string) => boolean): { preset: Preset; custom: DateRange | null } {
  const p = new URLSearchParams(search)
  const v = p.get('range')
  if (isOverview(v)) return { preset: v, custom: null }
  if (v === 'custom') {
    if (!p.has('from') && !p.has('to')) return { preset: 'custom', custom: null } // the picker, nothing chosen yet
    const from = p.get('from') ?? ''
    const to = p.get('to') ?? ''
    if (isValidCustom(from, to)) return { preset: 'custom', custom: { from, to } }
  }
  return { preset: DEFAULT_PRESET, custom: null }
}

/** "?range=7d" (or the custom form). The default is written out too, so a shared link never depends on defaults. */
export function rangeSearch(preset: Preset, custom?: DateRange | null): string {
  if (preset === 'custom') return custom ? `?range=custom&from=${custom.from}&to=${custom.to}` : `?range=${DEFAULT_PRESET}`
  return `?range=${preset}`
}

export const analyticsHref = (preset: Preset, custom?: DateRange | null) => `/analytics${rangeSearch(preset, custom)}`

/** "previous 7 days": the comparison period is always the same length, immediately before. */
export const previousLabel = (range: DateRange) => `previous ${rangeLength(range)} days`

export interface Trends { views: Trend; ratings: Trend; avg: Trend; surveys: Trend; clicks: Trend; ctr: Trend }

/** Every KPI trend, from one place. prev is null when there is no comparison period (all time). */
export function buildTrends(cur: Summary, prev: Summary | null): Trends {
  const o = (kind: 'count' | 'average' | 'rate') => ({ kind, curRatings: cur.ratings, prevRatings: prev ? prev.ratings : null })
  return {
    views: trend(cur.page_views, prev?.page_views ?? null, o('count')),
    ratings: trend(cur.ratings, prev?.ratings ?? null, o('count')),
    avg: trend(cur.avg_rating, prev?.avg_rating ?? null, o('average')),
    surveys: trend(cur.survey_completions, prev?.survey_completions ?? null, o('count')),
    clicks: trend(cur.google_clicks, prev?.google_clicks ?? null, o('count')),
    ctr: trend(
      clickThroughRate(cur.google_clicks, cur.page_views),
      prev ? clickThroughRate(prev.google_clicks, prev.page_views) : null,
      o('rate'),
    ),
  }
}

export interface SummaryLine { text: string; kind: 'empty' | 'no-comparison' | 'small-sample' | 'up' | 'down' | 'flat' }

/**
 * One rule-based sentence about the average rating. No AI: a few fixed cases, in this order.
 * The direction comes from the same trend() the arrows use, so the sentence and the arrow can never disagree.
 */
export function summaryLine(cur: Summary, prev: Summary | null, range: DateRange): SummaryLine {
  if (cur.ratings === 0) return { kind: 'empty', text: 'No ratings in this period yet.' }
  if (!prev) return { kind: 'no-comparison', text: 'All time has no earlier period, so there is no comparison to show.' }
  if (Math.min(cur.ratings, prev.ratings) < MIN_RATINGS_FOR_TREND) {
    return { kind: 'small-sample', text: 'Not enough ratings yet to show a trend.' }
  }
  const t = trend(cur.avg_rating, prev.avg_rating, { kind: 'average', curRatings: cur.ratings, prevRatings: prev.ratings })
  const vs = previousLabel(range)
  if (t.direction === 'up' || t.direction === 'down') {
    return { kind: t.direction, text: `Average rating is ${t.direction} ${t.label.slice(1)} vs the ${vs}.` }
  }
  return { kind: 'flat', text: `Average rating is unchanged vs the ${vs}.` }
}
