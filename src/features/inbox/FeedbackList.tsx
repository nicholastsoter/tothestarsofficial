import { useCallback, useEffect, useRef, useState } from 'react'
import { buildCsvBlob } from '../../lib/csv'
import { downloadBlob } from '../qr/qrExports'
import { fetchAll, fetchPage, type InboxRow } from './api'
import FeedbackCard from './FeedbackCard'
import { DEFAULT_FILTERS, PAGE_SIZE, hasActiveFilters, pageCount, type Filters, type SortKey, type StatusFilter } from './filters'

const sel = 'rounded-lg border-0 bg-white px-2.5 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-600 focus:outline-none'

/** The inbox ('inbox') and the survey Responses tab ('responses') share this list. */
export default function FeedbackList({ mode, timeZone, slug }: { mode: 'inbox' | 'responses'; timeZone: string; slug: string }) {
  const responses = mode === 'responses'
  const base: Filters = responses ? { ...DEFAULT_FILTERS, maxStar: 3 } : DEFAULT_FILTERS
  const maxPickable = responses ? 3 : 5

  const [filters, setFilters] = useState<Filters>(base)
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: InboxRow[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const latest = useRef(0)

  // search runs 350 ms after the owner stops typing
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchText ? f : { ...f, search: searchText }))
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [searchText])

  const load = useCallback(async () => {
    const id = ++latest.current
    setLoading(true)
    try {
      const result = await fetchPage(filters, page, { onlySurveys: responses })
      if (id !== latest.current) return
      if (result.rows.length === 0 && page > 0) return setPage(Math.max(0, pageCount(result.total) - 1)) // last item on the page was removed
      setData(result)
      setError(null)
    } catch {
      if (id === latest.current) setError('We couldn’t load your feedback. Please try again.')
    } finally {
      if (id === latest.current) setLoading(false)
    }
  }, [filters, page, responses])

  useEffect(() => {
    void load()
  }, [load])

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(0)
  }
  const reset = () => {
    setFilters(base)
    setSearchText('')
    setPage(0)
  }

  async function exportCsv(which: 'filtered' | 'all') {
    setExporting('Collecting feedback…')
    try {
      const rows = await fetchAll(which === 'all' ? DEFAULT_FILTERS : filters, {}, (done, total) => setExporting(`Collecting feedback… ${done} of ${total}`))
      setExporting(`Building file… (${rows.length} rows)`)
      const blob = await buildCsvBlob(rows, timeZone)
      downloadBlob(blob, `${slug}-feedback-${new Date().toISOString().slice(0, 10)}.csv`)
      setExporting(null)
    } catch {
      setExporting('The export failed. Please try again.')
    }
  }

  const total = data?.total ?? 0
  const pages = pageCount(total)

  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:grid-cols-6 sm:p-4">
        <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search messages and answers" aria-label="Search feedback" className={`${sel} sm:col-span-6`} />
        <select aria-label="Status" value={filters.status} onChange={(e) => update({ status: e.target.value as StatusFilter })} className={`${sel} sm:col-span-2`}>
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="resolved">Resolved</option>
        </select>
        <select aria-label="Lowest rating" value={filters.minStar} onChange={(e) => update({ minStar: Number(e.target.value) })} className={sel}>
          {Array.from({ length: maxPickable }, (_, i) => i + 1).map((n) => <option key={n} value={n}>From {n}★</option>)}
        </select>
        <select aria-label="Highest rating" value={filters.maxStar} onChange={(e) => update({ maxStar: Number(e.target.value) })} className={sel}>
          {Array.from({ length: maxPickable }, (_, i) => i + 1).map((n) => <option key={n} value={n}>To {n}★</option>)}
        </select>
        <input type="date" aria-label="From date" value={filters.from} onChange={(e) => update({ from: e.target.value })} className={sel} />
        <input type="date" aria-label="To date" value={filters.to} onChange={(e) => update({ to: e.target.value })} className={sel} />
        <select aria-label="Sort" value={filters.sort} onChange={(e) => update({ sort: e.target.value as SortKey })} className={`${sel} sm:col-span-3`}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="stars_high">Highest stars first</option>
          <option value="stars_low">Lowest stars first</option>
        </select>
        <div className="flex items-center gap-3 sm:col-span-3">
          {(hasActiveFilters(filters, base) || searchText) && <button type="button" onClick={reset} className="text-sm text-indigo-600 hover:underline">Reset filters</button>}
          <span className="ml-auto text-xs text-slate-500" aria-live="polite">{loading ? 'Loading…' : `${total} ${total === 1 ? 'item' : 'items'}`}</span>
        </div>
      </div>

      {!responses && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={exporting !== null && !exporting.startsWith('The export')} onClick={() => exportCsv('filtered')} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50">
            Export this view (CSV)
          </button>
          <button type="button" disabled={exporting !== null && !exporting.startsWith('The export')} onClick={() => exportCsv('all')} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50">
            Export everything (CSV)
          </button>
          {exporting && <span role="status" className="text-xs text-slate-600">{exporting}</span>}
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">{error}</p>}

      {data && data.rows.length === 0 && !loading && !error && (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
          {hasActiveFilters(filters, base) || searchText ? 'No feedback matches these filters.' : responses ? 'No survey responses yet. They appear here when customers who give 3 stars or fewer answer your survey.' : 'No feedback yet. Ratings without a message or survey answers don’t appear here, but they still count in Analytics.'}
        </div>
      )}

      <ul className="space-y-3">
        {data?.rows.map((row) => (
          <FeedbackCard
            key={row.id}
            row={row}
            timeZone={timeZone}
            onChanged={(patch) => setData((d) => d && { ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)) })}
            onDeleted={() => void load()}
          />
        ))}
      </ul>

      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading} className="rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-slate-300 disabled:opacity-40">Previous</button>
          <span className="text-sm text-slate-600">Page {page + 1} of {pages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1 || loading} className="rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-slate-300 disabled:opacity-40">Next</button>
        </nav>
      )}
    </div>
  )
}
