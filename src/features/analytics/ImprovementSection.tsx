import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchBeforeAfter, fetchSeries, fetchSummary, type BeforeAfterRow, type SeriesRow, type Summary } from './api'
import { AverageChart, MixChart } from './Charts'
import { addDays, formatRange, type Bucket } from './ranges'
import { MIN_RATINGS_FOR_TREND, formatAvg, formatInt, formatPercent, goalProgress } from './trend'

type Gran = 'week' | 'month'

function GoalCard({ goal, last30 }: { goal: number | null; last30: Summary | null }) {
  const avg = last30?.avg_rating ?? null
  const progress = goalProgress(avg, goal)
  return (
    <section className="viz rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--viz-text)' }}>Progress toward your goal</h3>
      {goal === null ? (
        <p className="mt-2 text-sm text-slate-600">You haven’t set a goal yet. <Link to="/settings" className="font-medium text-indigo-600 underline">Set one in Settings</Link> to track your average rating against it.</p>
      ) : avg === null ? (
        <p className="mt-2 text-sm text-slate-600">No ratings in the last 30 days yet, so there’s nothing to measure against your {goal.toFixed(1)}★ goal.</p>
      ) : (
        <>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold" style={{ color: 'var(--viz-text)' }}>{formatAvg(avg, 2)}</span>
            <span className="text-sm" style={{ color: 'var(--viz-text-2)' }}>of your {goal.toFixed(1)} goal · {formatPercent(progress)}</span>
          </p>
          <div className="mt-3 h-3 overflow-hidden rounded-full" style={{ background: '#cde2fb' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)} aria-label="Progress toward your goal rating">
            <div className="h-3 rounded-full" style={{ width: `${(progress ?? 0) * 100}%`, background: 'var(--series-1)' }} />
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Average of the last 30 days: {formatInt(last30!.ratings)} {last30!.ratings === 1 ? 'rating' : 'ratings'}.
            {last30!.ratings < MIN_RATINGS_FOR_TREND && ` That’s fewer than ${MIN_RATINGS_FOR_TREND}, so treat this as a rough guide.`}
            {avg >= goal && ' You’ve reached your goal.'}
          </p>
        </>
      )}
    </section>
  )
}

function BeforeAfterCard({ rows, trackingStart }: { rows: BeforeAfterRow[]; trackingStart: string }) {
  const before = rows.find((r) => r.period === 'before')
  const after = rows.find((r) => r.period === 'after')
  const heading = <h3 className="text-sm font-semibold" style={{ color: 'var(--viz-text)' }}>Before and after you started</h3>

  if (!before || !after) {
    return (
      <section className="viz rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        {heading}
        <p className="mt-2 text-sm text-slate-600">Your tracking start date ({trackingStart}) hasn’t arrived yet, so there’s nothing to compare. You can change it in <Link to="/settings" className="font-medium text-indigo-600 underline">Settings</Link>.</p>
      </section>
    )
  }

  const enoughBefore = before.ratings >= MIN_RATINGS_FOR_TREND
  const enoughAfter = after.ratings >= MIN_RATINGS_FOR_TREND
  const diff = enoughBefore && enoughAfter && before.avg_rating !== null && after.avg_rating !== null ? Math.round((after.avg_rating - before.avg_rating) * 10) / 10 : null
  const tile = (title: string, r: BeforeAfterRow, strong: boolean) => (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-medium" style={{ color: 'var(--viz-text-2)' }}>{title}</p>
      <p className="mt-1 text-2xl font-semibold" style={{ color: 'var(--viz-text)' }}>{formatAvg(r.avg_rating, 2)}<span className="text-base" aria-hidden style={{ color: strong ? 'var(--series-1)' : 'var(--series-muted)' }}> ★</span></p>
      <p className="mt-0.5 text-xs" style={{ color: 'var(--viz-text-2)' }}>{formatInt(r.ratings)} {r.ratings === 1 ? 'rating' : 'ratings'} · {formatRange({ from: r.from_date, to: r.to_date })}</p>
    </div>
  )

  return (
    <section className="viz rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      {heading}
      <p className="mt-0.5 text-xs" style={{ color: 'var(--viz-text-2)' }}>{before.days} days either side of your tracking start date ({trackingStart}).</p>
      {!enoughBefore ? (
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <p className="font-medium">Not enough “before” data to compare.</p>
          <p className="mt-1">We have {before.ratings} {before.ratings === 1 ? 'rating' : 'ratings'} from the {before.days} days before {trackingStart}, and we need at least {MIN_RATINGS_FOR_TREND}. We only know about customers who used your review page, so there is nothing to compare against from before you started. This fills in once you have earlier ratings, or you can change the start date in <Link to="/settings" className="font-medium underline">Settings</Link>.</p>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {tile('Before', before, false)}
          {tile('After', after, true)}
        </div>
      )}
      {diff !== null && <p className="mt-3 text-sm" style={{ color: 'var(--viz-text)' }}>Average rating is <strong>{diff > 0 ? `up ${diff.toFixed(1)}` : diff < 0 ? `down ${Math.abs(diff).toFixed(1)}` : 'unchanged'}</strong> since you started.</p>}
      {enoughBefore && !enoughAfter && <p className="mt-3 text-xs text-slate-600">Only {after.ratings} {after.ratings === 1 ? 'rating' : 'ratings'} since you started, so there’s no conclusion yet.</p>}
    </section>
  )
}

export default function ImprovementSection({ today, trackingStart, goal }: { today: string; trackingStart: string; goal: number | null }) {
  const [gran, setGran] = useState<Gran>('week')
  const [series, setSeries] = useState<SeriesRow[] | null>(null)
  const [ba, setBa] = useState<BeforeAfterRow[] | null>(null)
  const [last30, setLast30] = useState<Summary | null>(null)
  const [error, setError] = useState(false)

  // the last 26 weeks, or the last 12 months, whichever the owner picks
  useEffect(() => {
    let alive = true
    const from = gran === 'week' ? addDays(today, -(26 * 7 - 1)) : addDays(today, -364)
    setSeries(null)
    fetchSeries({ from, to: today }, gran as Bucket).then((r) => alive && setSeries(r)).catch(() => alive && setError(true))
    return () => { alive = false }
  }, [gran, today])

  useEffect(() => {
    let alive = true
    fetchBeforeAfter(90).then((r) => alive && setBa(r)).catch(() => alive && setError(true))
    fetchSummary({ from: addDays(today, -29), to: today }).then((r) => alive && setLast30(r)).catch(() => alive && setError(true))
    return () => { alive = false }
  }, [today])

  if (error) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">We couldn’t load the improvement numbers. Please refresh the page.</p>

  return (
    <section aria-labelledby="improve-h" className="space-y-4">
      <div>
        <h2 id="improve-h" className="text-lg font-semibold">Improvement over time</h2>
        <p className="mt-1 text-sm text-slate-600">This reflects customers who used your review page. It is not your business’s full Google rating, which includes reviews we never see.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GoalCard goal={goal} last30={last30} />
        {ba ? <BeforeAfterCard rows={ba} trackingStart={trackingStart} /> : <p className="text-sm text-slate-500" role="status">Loading…</p>}
      </div>

      <div role="group" aria-label="Trend granularity" className="flex gap-1">
        {(['week', 'month'] as Gran[]).map((g) => (
          <button key={g} type="button" aria-pressed={gran === g} onClick={() => setGran(g)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${gran === g ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
            {g === 'week' ? 'Weekly (26 weeks)' : 'Monthly (12 months)'}
          </button>
        ))}
      </div>
      {series ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <AverageChart rows={series} bucket={gran} goal={goal} title={gran === 'week' ? 'Weekly average rating' : 'Monthly average rating'} />
          <MixChart rows={series} bucket={gran} />
        </div>
      ) : (
        <p className="text-sm text-slate-500" role="status">Loading…</p>
      )}
    </section>
  )
}
