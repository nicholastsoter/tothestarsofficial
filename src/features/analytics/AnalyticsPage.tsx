import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBusiness } from '../../contexts/BusinessContext'
import { fetchContext, fetchDistribution, fetchGoogleCtr, fetchSeries, fetchSummary, type Context, type CtrRow, type SeriesRow, type Summary } from './api'
import { AverageChart, DistributionChart, Funnel, GoogleCtrChart, VolumeChart } from './Charts'
import GoogleRatingPanel from './GoogleRatingPanel'
import ImprovementSection from './ImprovementSection'
import KpiCard from './KpiCard'
import { analyticsStateFromSearch, buildTrends, previousLabel, rangeSearch } from './rangeState'
import {
  PRESET_LABELS, allowedBuckets, defaultBucket, formatRange, isDate, presetRange, previousRange, rangeLength, validateCustom,
  type Bucket, type DateRange, type Preset,
} from './ranges'
import { SMALL_SAMPLE_NOTE, clickThroughRate, formatAvg, formatInt, formatPercent } from './trend'

interface Loaded { current: Summary; previous: Summary | null; series: SeriesRow[]; distribution: number[]; ctr: CtrRow[]; range: DateRange; bucket: Bucket }

const PRESETS: Preset[] = ['7d', '30d', '90d', 'all', 'custom']
const input = 'rounded-lg border-0 bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-600 focus:outline-none'

export default function AnalyticsPage() {
  const { business, loading } = useBusiness()
  const [ctx, setCtx] = useState<Context | null>(null)
  // The range lives in the URL (?range=7d), so links and the back button work and nothing is kept in browser storage.
  const [params, setParams] = useSearchParams()
  const search = `?${params.toString()}`
  const { preset, custom: customApplied } = useMemo(
    () => analyticsStateFromSearch(search, (f, t) => isDate(f) && isDate(t) && f <= t && rangeLength({ from: f, to: t }) <= 3650),
    [search],
  )
  const [customDraft, setCustomDraft] = useState({ from: customApplied?.from ?? '', to: customApplied?.to ?? '' })
  const [customError, setCustomError] = useState<string | null>(null)
  const [bucketPick, setBucketPick] = useState<Bucket | null>(null)
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(true)
  const latest = useRef(0)

  useEffect(() => {
    if (!business) return
    fetchContext().then(setCtx).catch(() => setError(true))
  }, [business])

  const range: DateRange | null = useMemo(() => {
    if (!ctx) return null
    if (preset === 'custom') return customApplied && validateCustom(customApplied.from, customApplied.to, ctx.today) === null ? customApplied : null // null until a valid range is applied
    return presetRange(preset, ctx.today, ctx.first_date)
  }, [ctx, preset, customApplied])

  const bucket: Bucket | null = range ? (bucketPick && allowedBuckets(range).includes(bucketPick) ? bucketPick : defaultBucket(range)) : null

  useEffect(() => {
    if (!range || !bucket) return
    const id = ++latest.current
    const prev = previousRange(range, preset)
    setBusy(true)
    Promise.all([
      fetchSummary(range),
      prev ? fetchSummary(prev) : Promise.resolve(null),
      fetchSeries(range, bucket),
      fetchDistribution(range),
      fetchGoogleCtr(range),
    ])
      .then(([current, previous, series, distribution, ctr]) => {
        if (id !== latest.current) return
        setData({ current, previous, series, distribution, ctr, range, bucket })
        setError(false)
      })
      .catch(() => id === latest.current && setError(true))
      .finally(() => id === latest.current && setBusy(false))
  }, [range, bucket, preset])

  if (loading) return <p className="text-sm text-slate-500" role="status">Loading…</p>
  if (!business) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-2 text-slate-600">Create your business on the <Link to="/dashboard" className="font-medium text-indigo-600">Dashboard</Link> first.</p>
      </div>
    )
  }

  function applyCustom() {
    if (!ctx) return
    const problem = validateCustom(customDraft.from, customDraft.to, ctx.today)
    setCustomError(problem)
    if (!problem) setParams(new URLSearchParams(rangeSearch('custom', customDraft)))
  }

  const cur = data?.current
  const prev = data?.previous ?? null
  const prevLabel = data && prev ? previousLabel(data.range) : undefined
  const ctrCur = cur ? clickThroughRate(cur.google_clicks, cur.page_views) : null
  const trends = cur && buildTrends(cur, prev)
  const suppressedReason = trends && Object.values(trends).find((t) => t.direction === 'none' && t.reason)?.reason
  const noData = cur && cur.page_views === 0 && cur.ratings === 0 && cur.star_taps === 0

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-slate-600">
          {data ? formatRange(data.range) : 'Loading…'}
          {ctx && <> · days follow your business time zone ({ctx.timezone})</>}
        </p>
      </div>

      <GoogleRatingPanel />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button key={p} type="button" aria-pressed={preset === p} onClick={() => { setBucketPick(null); if (p === 'custom') setParams(new URLSearchParams(customApplied ? rangeSearch('custom', customApplied) : '?range=custom')); else setParams(new URLSearchParams(rangeSearch(p))) }} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${preset === p ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'}`}>
            {PRESET_LABELS[p]}
          </button>
        ))}
        {range && bucket && (
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            Group by
            <select aria-label="Group by" value={bucket} onChange={(e) => setBucketPick(e.target.value as Bucket)} className={input}>
              {allowedBuckets(range).map((b) => <option key={b} value={b}>{b === 'day' ? 'Day' : b === 'week' ? 'Week' : 'Month'}</option>)}
            </select>
          </label>
        )}
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <label className="text-sm text-slate-600">From<input type="date" max={ctx?.today} value={customDraft.from} onChange={(e) => setCustomDraft({ ...customDraft, from: e.target.value })} className={`${input} mt-1 block`} /></label>
          <label className="text-sm text-slate-600">To<input type="date" max={ctx?.today} value={customDraft.to} onChange={(e) => setCustomDraft({ ...customDraft, to: e.target.value })} className={`${input} mt-1 block`} /></label>
          <button type="button" onClick={applyCustom} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">Apply</button>
          {customError && <p role="alert" className="w-full text-sm text-red-700">{customError}</p>}
          {!customApplied && !customError && <p className="w-full text-xs text-slate-500">Choose a start and end date, then Apply.</p>}
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">We couldn’t load your analytics. Please refresh the page.</p>}

      {noData && !busy && (
        <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
          No activity in this period. Page views and ratings appear here once customers scan your QR code or open your review link.
          {preset !== 'all' && ' Try a longer range.'}
        </div>
      )}

      {cur && trends && (
        <>
          <div className={`grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6 ${busy ? 'opacity-60' : ''}`} aria-busy={busy}>
            <KpiCard label="Page views" value={formatInt(cur.page_views)} trend={trends.views} previous={prevLabel} hint="Raw counts of the review page being opened" />
            <KpiCard label="Ratings collected" value={formatInt(cur.ratings)} trend={trends.ratings} previous={prevLabel} hint="One per customer visit that picked a star" />
            <KpiCard label="Average rating" value={formatAvg(cur.avg_rating)} trend={trends.avg} previous={prevLabel} />
            <KpiCard label="Survey completions" value={formatInt(cur.survey_completions)} trend={trends.surveys} previous={prevLabel} />
            <KpiCard label="Google link clicks" value={formatInt(cur.google_clicks)} trend={trends.clicks} previous={prevLabel} />
            <KpiCard label="Click-through rate" value={formatPercent(ctrCur)} trend={trends.ctr} previous={prevLabel} hint="Google link clicks divided by page views" />
          </div>
          {suppressedReason && <p className="-mt-3 text-xs text-slate-600">No trend arrows: {suppressedReason === SMALL_SAMPLE_NOTE ? SMALL_SAMPLE_NOTE : suppressedReason}</p>}

          <div className="grid gap-4 lg:grid-cols-2">
            <VolumeChart rows={data.series} bucket={data.bucket} />
            <AverageChart rows={data.series} bucket={data.bucket} goal={business.goal_rating} />
            <DistributionChart counts={data.distribution} />
            <GoogleCtrChart rows={data.ctr} />
            <Funnel steps={[
              { label: 'Page views', value: cur.page_views },
              { label: 'Star taps', value: cur.star_taps },
              { label: 'Feedback with a message or answers', value: cur.with_content },
              { label: 'Google link clicks', value: cur.google_clicks },
            ]} />
          </div>

          <p className="text-xs text-slate-500">
            Page views and clicks are raw counts: we don’t store a visitor ID, so one person opening the page twice counts twice.
            Ratings are counted once per visit from saved feedback, not from star taps. The overall click-through rate (clicks ÷ page views) can exceed 100% if people click more than once; the by-star chart caps each star at one click per rating.
          </p>
        </>
      )}

      {ctx && <ImprovementSection today={ctx.today} trackingStart={ctx.tracking_start_date} goal={business.goal_rating} />}
    </div>
  )
}
