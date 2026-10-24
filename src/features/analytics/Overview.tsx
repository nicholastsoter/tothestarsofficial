import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBusiness } from '../../contexts/BusinessContext'
import { fetchAwaitingCount } from '../inbox/api'
import { fetchContext, fetchSeries, fetchSummary, type Context, type SeriesRow, type Summary } from './api'
import { AverageChart, VolumeChart } from './Charts'
import KpiCard from './KpiCard'
import { OVERVIEW_PRESETS, analyticsHref, buildTrends, presetFromSearch, previousLabel, rangeSearch, summaryLine } from './rangeState'
import { PRESET_LABELS, defaultBucket, formatRange, presetRange, previousRange, type Bucket, type DateRange } from './ranges'
import { SMALL_SAMPLE_NOTE, formatAvg, formatInt } from './trend'

interface Loaded { current: Summary; previous: Summary | null; series: SeriesRow[]; range: DateRange; bucket: Bucket }

/** The dashboard home once setup is finished: three headline numbers, two small charts and one plain sentence. */
export default function Overview() {
  const { business } = useBusiness()
  const [params, setParams] = useSearchParams()
  const preset = presetFromSearch(`?${params.toString()}`)
  const [ctx, setCtx] = useState<Context | null>(null)
  const [data, setData] = useState<Loaded | null>(null)
  const [awaiting, setAwaiting] = useState<number | null | 'error'>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(true)
  const latest = useRef(0)

  useEffect(() => {
    if (!business) return
    fetchContext().then(setCtx).catch(() => setError(true))
    fetchAwaitingCount().then(setAwaiting).catch(() => setAwaiting('error'))
  }, [business])

  useEffect(() => {
    if (!ctx) return
    const id = ++latest.current
    const range = presetRange(preset, ctx.today, ctx.first_date)
    const prev = previousRange(range, preset)
    const bucket = defaultBucket(range)
    setBusy(true)
    Promise.all([fetchSummary(range), prev ? fetchSummary(prev) : Promise.resolve(null), fetchSeries(range, bucket)])
      .then(([current, previous, series]) => {
        if (id !== latest.current) return
        setData({ current, previous, series, range, bucket })
        setError(false)
      })
      .catch(() => id === latest.current && setError(true))
      .finally(() => id === latest.current && setBusy(false))
  }, [ctx, preset])

  const cur = data?.current
  const trends = cur && buildTrends(cur, data.previous)
  const line = cur && data ? summaryLine(cur, data.previous, data.range) : null
  const prevLabel = data && data.previous ? previousLabel(data.range) : undefined
  const noArrowReason = trends && [trends.ratings, trends.avg].find((t) => t.direction === 'none' && t.reason)?.reason

  return (
    <section aria-label="Overview" className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{business ? `Welcome back, ${business.name}` : 'Overview'}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {data ? formatRange(data.range) : 'Loading…'}
            {ctx && <> · days follow your business time zone ({ctx.timezone})</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
          {OVERVIEW_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => setParams(new URLSearchParams(rangeSearch(p)))}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${preset === p ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'}`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">We couldn’t load your overview. Please refresh the page.</p>}

      {cur && trends && line && data && (
        <>
          <p className={`rounded-xl bg-white px-4 py-3 text-sm font-medium shadow-sm ring-1 ring-slate-200 ${busy ? 'opacity-60' : ''}`} data-testid="summary-line" data-kind={line.kind}>
            {line.text}
          </p>

          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-3 ${busy ? 'opacity-60' : ''}`} aria-busy={busy}>
            <KpiCard label="Ratings collected" value={formatInt(cur.ratings)} trend={trends.ratings} previous={prevLabel} hint="One per customer visit that picked a star" note={data.previous ? undefined : 'No earlier period to compare'} />
            <KpiCard label="Average rating" value={formatAvg(cur.avg_rating)} trend={trends.avg} previous={prevLabel} note={data.previous ? undefined : 'No earlier period to compare'} />
            <KpiCard
              label="New feedback awaiting response"
              value={awaiting === null ? '…' : awaiting === 'error' ? '–' : formatInt(awaiting)}
              trend={{ direction: 'none', label: '' }}
              hint="Messages and survey answers still marked New in your inbox. This is a right-now count, so it doesn’t follow the date range."
              note="Right now · not tied to the range"
            />
          </div>
          {noArrowReason && data.previous && <p className="-mt-2 text-xs text-slate-600">No trend arrows: {noArrowReason === SMALL_SAMPLE_NOTE ? SMALL_SAMPLE_NOTE : noArrowReason}</p>}
          {awaiting !== null && awaiting !== 'error' && awaiting > 0 && (
            <p className="-mt-2 text-sm"><Link to="/inbox" className="font-medium text-indigo-600 hover:underline">Open your inbox →</Link></p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <VolumeChart rows={data.series} bucket={data.bucket} height={170} />
            <AverageChart rows={data.series} bucket={data.bucket} height={170} subtitle={`Average per ${data.bucket}. Hollow dots have fewer than 5 ratings.`} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>Ratings are counted once per customer visit, from saved feedback.</span>
            <Link to={analyticsHref(preset)} className="text-sm font-medium text-indigo-600 hover:underline">View full analytics →</Link>
          </div>
        </>
      )}
    </section>
  )
}
