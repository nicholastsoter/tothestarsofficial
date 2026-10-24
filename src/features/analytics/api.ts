import { supabase } from '../../lib/supabase'
import type { Bucket } from './ranges'

export interface Context { timezone: string; today: string; first_date: string | null; tracking_start_date: string }
export interface Summary {
  page_views: number; star_taps: number; ratings: number; avg_rating: number | null
  with_content: number; survey_completions: number; google_clicks: number
}
export interface SeriesRow {
  bucket_start: string; ratings: number; avg_rating: number | null; page_views: number; google_clicks: number
  star1: number; star2: number; star3: number; star4: number; star5: number
}
export interface Slice { from: string | null; to: string | null }
export interface CtrRow { star: number; ratings: number; clicks: number; counted_clicks: number; click_through: number | null }
export interface BeforeAfterRow {
  period: 'before' | 'after'; from_date: string; to_date: string; days: number; ratings: number; avg_rating: number | null
  star1: number; star2: number; star3: number; star4: number; star5: number
}

const n = (v: unknown) => Number(v ?? 0)
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const fail = () => new Error('Could not load analytics')

export async function fetchContext(): Promise<Context | null> {
  const { data, error } = await supabase.rpc('analytics_context')
  if (error) throw fail()
  const r = (data as Context[] | null)?.[0]
  return r ?? null
}

export async function fetchSummary(s: Slice): Promise<Summary> {
  const { data, error } = await supabase.rpc('analytics_summary', { p_from: s.from, p_to: s.to })
  if (error) throw fail()
  const r = (data as Record<string, unknown>[] | null)?.[0]
  return {
    page_views: n(r?.page_views), star_taps: n(r?.star_taps), ratings: n(r?.ratings), avg_rating: nn(r?.avg_rating),
    with_content: n(r?.with_content), survey_completions: n(r?.survey_completions), google_clicks: n(r?.google_clicks),
  }
}

export async function fetchSeries(s: Slice, bucket: Bucket): Promise<SeriesRow[]> {
  const { data, error } = await supabase.rpc('analytics_timeseries', { p_from: s.from, p_to: s.to, p_bucket: bucket })
  if (error) throw fail()
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    bucket_start: String(r.bucket_start), ratings: n(r.ratings), avg_rating: nn(r.avg_rating), page_views: n(r.page_views), google_clicks: n(r.google_clicks),
    star1: n(r.star1), star2: n(r.star2), star3: n(r.star3), star4: n(r.star4), star5: n(r.star5),
  }))
}

export async function fetchDistribution(s: Slice): Promise<number[]> {
  const { data, error } = await supabase.rpc('analytics_distribution', { p_from: s.from, p_to: s.to })
  if (error) throw fail()
  const out = [0, 0, 0, 0, 0]
  for (const r of (data ?? []) as { star: number; ratings: number }[]) out[Number(r.star) - 1] = n(r.ratings)
  return out
}

export async function fetchBeforeAfter(maxDays = 90): Promise<BeforeAfterRow[]> {
  const { data, error } = await supabase.rpc('analytics_before_after', { p_max_days: maxDays })
  if (error) throw fail()
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    period: r.period as 'before' | 'after', from_date: String(r.from_date), to_date: String(r.to_date), days: n(r.days), ratings: n(r.ratings), avg_rating: nn(r.avg_rating),
    star1: n(r.star1), star2: n(r.star2), star3: n(r.star3), star4: n(r.star4), star5: n(r.star5),
  }))
}

/** One row per star 1-5, plus a star-0 row only when some clicks carry no star. */
export async function fetchGoogleCtr(s: Slice): Promise<CtrRow[]> {
  const { data, error } = await supabase.rpc('analytics_google_ctr', { p_from: s.from, p_to: s.to })
  if (error) throw fail()
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    star: n(r.star), ratings: n(r.ratings), clicks: n(r.clicks), counted_clicks: n(r.counted_clicks), click_through: nn(r.click_through),
  }))
}
