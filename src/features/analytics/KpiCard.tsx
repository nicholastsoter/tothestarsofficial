import type { Trend } from './trend'

const ARROW = { up: '▲', down: '▼', flat: '▬', none: '' } as const

/** One headline number. The arrow's colour says better/worse; its text and shape say it too, so colour is never alone. */
export default function KpiCard({ label, value, trend, previous, hint }: { label: string; value: string; trend: Trend; previous?: string; hint?: string }) {
  const colour = trend.direction === 'up' ? 'var(--good)' : trend.direction === 'down' ? 'var(--critical)' : 'var(--viz-text-2)'
  return (
    <div className="viz rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium" style={{ color: 'var(--viz-text-2)' }} title={hint}>{label}</p>
      <p className="mt-1 text-3xl font-semibold" style={{ color: 'var(--viz-text)' }}>{value}</p>
      <p className="mt-1 h-4 text-xs" style={{ color: 'var(--viz-text-2)' }}>
        {trend.direction !== 'none' && (
          <>
            <span aria-hidden style={{ color: colour }}>{ARROW[trend.direction]}</span>{' '}
            <span className="sr-only">{trend.direction === 'up' ? 'Up' : trend.direction === 'down' ? 'Down' : 'Unchanged'}: </span>
            {trend.label}
            {previous && <span> vs {previous}</span>}
          </>
        )}
      </p>
    </div>
  )
}
