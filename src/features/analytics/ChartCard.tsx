import { useState, type ReactNode } from 'react'

export interface TableData { headers: string[]; rows: (string | number)[][] }

/** Frame for every chart: title, one-line "what am I looking at", the chart, and a plain table of the same numbers. */
export default function ChartCard({ title, subtitle, table, empty, children }: { title: string; subtitle?: string; table: TableData; empty?: string | null; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className="viz rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--viz-text)' }}>{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs" style={{ color: 'var(--viz-text-2)' }}>{subtitle}</p>}
        </div>
        {!empty && (
          <button type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            {asTable ? 'View chart' : 'View as table'}
          </button>
        )}
      </div>
      <div className="mt-3">
        {empty ? (
          <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm text-slate-600">{empty}</p>
        ) : asTable ? (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-left text-xs" style={{ color: 'var(--viz-text)' }}>
              <thead className="sticky top-0 bg-white" style={{ color: 'var(--viz-text-2)' }}>
                <tr>{table.headers.map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {r.map((c, j) => <td key={j} className="px-2 py-1.5 tabular-nums">{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
