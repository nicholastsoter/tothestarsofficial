import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, hasActiveFilters, pageCount, toRpcArgs } from './filters'

const page = { limit: 20, offset: 0 }

describe('toRpcArgs', () => {
  it('sends neutral values for the default filters', () => {
    expect(toRpcArgs(DEFAULT_FILTERS, page)).toEqual({
      p_status: null, p_min_star: 1, p_max_star: 5, p_from: null, p_to: null, p_search: null, p_only_surveys: false, p_sort: 'newest', p_limit: 20, p_offset: 0,
    })
  })
  it('passes status, dates, trimmed search and sort through', () => {
    const a = toRpcArgs({ ...DEFAULT_FILTERS, status: 'resolved', from: '2026-03-01', to: '2026-03-31', search: '  cold food ', sort: 'stars_low', minStar: 2, maxStar: 3 }, { ...page, offset: 40, onlySurveys: true })
    expect(a).toMatchObject({ p_status: 'resolved', p_from: '2026-03-01', p_to: '2026-03-31', p_search: 'cold food', p_sort: 'stars_low', p_min_star: 2, p_max_star: 3, p_only_surveys: true, p_offset: 40 })
  })
  it('drops malformed dates, clamps stars, caps search length and never goes below offset 0', () => {
    const a = toRpcArgs({ ...DEFAULT_FILTERS, from: 'yesterday', to: '2026-3-1', minStar: -4, maxStar: 99, search: 'x'.repeat(500) }, { limit: 20, offset: -5 })
    expect(a).toMatchObject({ p_from: null, p_to: null, p_min_star: 1, p_max_star: 5, p_offset: 0 })
    expect((a.p_search as string).length).toBe(200)
  })
})

describe('helpers', () => {
  it('detects active filters against a base', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, search: 'x' })).toBe(true)
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, maxStar: 3 }, { ...DEFAULT_FILTERS, maxStar: 3 })).toBe(false)
  })
  it('counts pages', () => {
    expect([0, 1, 20, 21, 100].map((n) => pageCount(n))).toEqual([1, 1, 1, 2, 5])
  })
})
