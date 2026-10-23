export type SortKey = 'newest' | 'oldest' | 'stars_high' | 'stars_low'
export type StatusFilter = 'all' | 'new' | 'resolved'

export interface Filters {
  status: StatusFilter
  minStar: number
  maxStar: number
  /** yyyy-mm-dd in the business's time zone, or '' for no limit */
  from: string
  to: string
  search: string
  sort: SortKey
}

export const PAGE_SIZE = 20
export const DEFAULT_FILTERS: Filters = { status: 'all', minStar: 1, maxStar: 5, from: '', to: '', search: '', sort: 'newest' }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const clampStar = (n: number) => Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)))

/** Turns the filter form into the arguments of the inbox_feedback database function. */
export function toRpcArgs(f: Filters, o: { onlySurveys?: boolean; limit: number; offset: number }): Record<string, unknown> {
  return {
    p_status: f.status === 'all' ? null : f.status,
    p_min_star: clampStar(f.minStar),
    p_max_star: clampStar(f.maxStar),
    p_from: DATE.test(f.from) ? f.from : null,
    p_to: DATE.test(f.to) ? f.to : null,
    p_search: f.search.trim() === '' ? null : f.search.trim().slice(0, 200),
    p_only_surveys: Boolean(o.onlySurveys),
    p_sort: f.sort,
    p_limit: o.limit,
    p_offset: Math.max(0, o.offset),
  }
}

export const hasActiveFilters = (f: Filters, base: Filters = DEFAULT_FILTERS) =>
  f.status !== base.status || f.minStar !== base.minStar || f.maxStar !== base.maxStar || f.from !== base.from || f.to !== base.to || f.search.trim() !== '' || f.sort !== base.sort

export const pageCount = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size))
