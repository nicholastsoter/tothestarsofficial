// The charts. Specs followed: bars at most 24px with a 4px rounded data end; 2px lines; 8px dots with a
// 2px surface ring; hairline solid gridlines; one y-axis per chart; text in ink tokens, never series colour.
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeriesRow } from './api'
import ChartCard from './ChartCard'
import { formatBucket, type Bucket } from './ranges'
import { MIN_RATINGS_FOR_TREND, formatAvg, formatInt } from './trend'

const AXIS = { fontSize: 11, fill: 'var(--viz-text-2)' }
const GRID = { stroke: 'var(--viz-grid)', strokeWidth: 1, vertical: false } as const

function TooltipBox({ title, lines }: { title: string; lines: [string, string][] }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200" style={{ color: 'var(--viz-text)' }}>
      <p className="font-semibold">{title}</p>
      {lines.map(([k, v]) => (
        <p key={k} className="mt-0.5 flex justify-between gap-4"><span style={{ color: 'var(--viz-text-2)' }}>{k}</span><span className="tabular-nums">{v}</span></p>
      ))}
    </div>
  )
}

/** Fewer ticks when there are many buckets, so labels never collide. */
const tickGap = (n: number) => (n > 24 ? 24 : n > 12 ? 12 : 4)

export function VolumeChart({ rows, bucket }: { rows: SeriesRow[]; bucket: Bucket }) {
  const data = rows.map((r) => ({ label: formatBucket(r.bucket_start, bucket), ratings: r.ratings }))
  const empty = rows.every((r) => r.ratings === 0) ? 'No ratings in this period yet. They appear here as customers tap a star.' : null
  return (
    <ChartCard title="Ratings collected" subtitle={`Ratings per ${bucket}`} empty={empty} table={{ headers: [bucket === 'month' ? 'Month' : bucket === 'week' ? 'Week starting' : 'Day', 'Ratings'], rows: data.map((d) => [d.label, d.ratings]) }}>
      <div style={{ height: 240 }} role="img" aria-label="Column chart of ratings collected over time">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--viz-grid)' }} interval="preserveStartEnd" minTickGap={tickGap(data.length)} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={({ active, payload }) => (active && payload?.length ? <TooltipBox title={String(payload[0].payload.label)} lines={[['Ratings', formatInt(Number(payload[0].value))]]} /> : null)} />
            <Bar dataKey="ratings" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

interface DotProps { cx?: number; cy?: number; payload?: { n: number; avg: number | null } }

/** Average rating over time. Buckets with fewer than 5 ratings get a hollow dot: real, but not much to go on. */
export function AverageChart({ rows, bucket, goal, title = 'Average rating', subtitle }: { rows: SeriesRow[]; bucket: Bucket; goal?: number | null; title?: string; subtitle?: string }) {
  const data = rows.map((r) => ({ label: formatBucket(r.bucket_start, bucket), avg: r.avg_rating, n: r.ratings }))
  const empty = data.every((d) => d.avg === null) ? 'No ratings in this period yet.' : null
  const dot = ({ cx, cy, payload }: DotProps) =>
    cx === undefined || cy === undefined || !payload || payload.avg === null ? <g key={`${cx}-${cy}`} /> : (
      <g key={`${cx}-${cy}`}>
        <circle cx={cx} cy={cy} r={6} fill="var(--viz-surface)" />
        <circle cx={cx} cy={cy} r={4} fill={payload.n >= MIN_RATINGS_FOR_TREND ? 'var(--series-1)' : 'var(--viz-surface)'} stroke="var(--series-1)" strokeWidth={2} />
      </g>
    )
  return (
    <ChartCard title={title} subtitle={subtitle ?? `Average per ${bucket}. Hollow dots have fewer than ${MIN_RATINGS_FOR_TREND} ratings.${goal ? ` The orange line is your ${goal.toFixed(1)} goal.` : ''}`} empty={empty} table={{ headers: ['Period', 'Average', 'Ratings'], rows: data.map((d) => [d.label, formatAvg(d.avg, 2), d.n]) }}>
      <div style={{ height: 240 }} role="img" aria-label="Line chart of average rating over time">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--viz-grid)' }} interval="preserveStartEnd" minTickGap={tickGap(data.length)} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} />
            {goal ? <ReferenceLine y={goal} stroke="var(--series-2)" strokeWidth={1} /> : null}
            <Tooltip content={({ active, payload }) => (active && payload?.length ? <TooltipBox title={String(payload[0].payload.label)} lines={[['Average', formatAvg(payload[0].payload.avg, 2)], ['Ratings', formatInt(payload[0].payload.n)]]} /> : null)} />
            <Line type="linear" dataKey="avg" stroke="var(--series-1)" strokeWidth={2} dot={dot as never} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

export function DistributionChart({ counts }: { counts: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0)
  const data = [5, 4, 3, 2, 1].map((s) => ({ star: `${s}★`, count: counts[s - 1], pct: total ? Math.round((counts[s - 1] / total) * 100) : 0 }))
  return (
    <ChartCard title="Star distribution" subtitle="How many ratings each star got" empty={total === 0 ? 'No ratings in this period yet.' : null} table={{ headers: ['Stars', 'Ratings', 'Share'], rows: data.map((d) => [d.star, d.count, `${d.pct}%`]) }}>
      <div style={{ height: 220 }} role="img" aria-label="Bar chart of ratings by star">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="star" tick={AXIS} tickLine={false} axisLine={false} width={32} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={({ active, payload }) => (active && payload?.length ? <TooltipBox title={String(payload[0].payload.star)} lines={[['Ratings', formatInt(payload[0].payload.count)], ['Share', `${payload[0].payload.pct}%`]]} /> : null)} />
            <Bar dataKey="count" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
              <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: 'var(--viz-text)' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

/** Four actions side by side. They are different actions, not a strict path, so each is shown against page views. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const base = steps[0]?.value ?? 0
  const fills = ['var(--ordinal-1)', 'var(--ordinal-2)', 'var(--ordinal-3)', 'var(--ordinal-4)']
  return (
    <ChartCard title="From page view to Google" subtitle="What visitors did, as a share of page views" empty={base === 0 && steps.every((s) => s.value === 0) ? 'No visits in this period yet.' : null} table={{ headers: ['Step', 'Count', 'Share of page views'], rows: steps.map((s) => [s.label, s.value, base ? `${Math.round((s.value / base) * 100)}%` : '–']) }}>
      <ul className="space-y-3" aria-label="Funnel">
        {steps.map((s, i) => {
          const pct = base ? Math.min(100, (s.value / base) * 100) : 0
          return (
            <li key={s.label}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span style={{ color: 'var(--viz-text)' }}>{s.label}</span>
                <span className="tabular-nums" style={{ color: 'var(--viz-text-2)' }}>{formatInt(s.value)}{base && i > 0 ? ` · ${Math.round((s.value / base) * 100)}%` : ''}</span>
              </div>
              <div className="h-4 rounded bg-slate-100">
                <div className="h-4 rounded" style={{ width: `${Math.max(pct, s.value > 0 ? 1.5 : 0)}%`, background: fills[i] ?? fills[3] }} />
              </div>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}

/** 5 stars grouped into three so the stack stays readable; the tooltip and table give every star. */
export function MixChart({ rows, bucket }: { rows: SeriesRow[]; bucket: Bucket }) {
  const data = rows.map((r) => ({ label: formatBucket(r.bucket_start, bucket), low: r.star1 + r.star2, mid: r.star3, high: r.star4 + r.star5, ...r }))
  const empty = rows.every((r) => r.ratings === 0) ? 'No ratings in this period yet.' : null
  return (
    <ChartCard title="Ratings mix over time" subtitle={`Share of happy (4-5★), neutral (3★) and unhappy (1-2★) ratings per ${bucket}`} empty={empty} table={{ headers: ['Period', '1★', '2★', '3★', '4★', '5★'], rows: data.map((d) => [d.label, d.star1, d.star2, d.star3, d.star4, d.star5]) }}>
      <div style={{ height: 250 }} role="img" aria-label="Stacked column chart of the mix of ratings over time">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--viz-grid)' }} interval="preserveStartEnd" minTickGap={tickGap(data.length)} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={({ active, payload }) => (active && payload?.length ? (
              <TooltipBox title={String(payload[0].payload.label)} lines={[['5★', String(payload[0].payload.star5)], ['4★', String(payload[0].payload.star4)], ['3★', String(payload[0].payload.star3)], ['2★', String(payload[0].payload.star2)], ['1★', String(payload[0].payload.star1)]]} />
            ) : null)} />
            <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: 'var(--viz-text-2)', fontSize: 12 }}>{v}</span>} />
            <Bar dataKey="low" name="Unhappy (1-2★)" stackId="m" fill="var(--series-2)" stroke="var(--viz-surface)" strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="mid" name="Neutral (3★)" stackId="m" fill="var(--series-muted)" stroke="var(--viz-surface)" strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="high" name="Happy (4-5★)" stackId="m" fill="var(--series-1)" stroke="var(--viz-surface)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
