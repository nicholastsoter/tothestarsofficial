import { describe, expect, it } from 'vitest'
import type { Summary } from './api'
import {
  DEFAULT_PRESET, OVERVIEW_PRESETS, analyticsHref, analyticsStateFromSearch, buildTrends, presetFromSearch, previousLabel, rangeSearch, summaryLine,
} from './rangeState'
import { isDate, presetRange, previousRange, validateCustom, type DateRange } from './ranges'

const sum = (over: Partial<Summary> = {}): Summary => ({
  page_views: 100, star_taps: 50, ratings: 20, avg_rating: 4, with_content: 5, survey_completions: 3, google_clicks: 10, ...over,
})
const today = '2026-10-23'
const first = '2025-01-01'
const rangeOf = (p: OverviewPresetLike) => presetRange(p, today, first)
type OverviewPresetLike = (typeof OVERVIEW_PRESETS)[number]
const prevOf = (p: OverviewPresetLike) => previousRange(rangeOf(p), p)

describe('range in the URL', () => {
  it('reads ?range= and falls back to 30 days for anything else', () => {
    expect(presetFromSearch('?range=7d')).toBe('7d')
    expect(presetFromSearch('?range=90d')).toBe('90d')
    expect(presetFromSearch('?range=all')).toBe('all')
    for (const bad of ['', '?', '?range=', '?range=1y', '?range=custom', '?range=7D', '?range=7d%20', '?other=7d', '?range[]=7d']) {
      expect(presetFromSearch(bad), bad).toBe(DEFAULT_PRESET)
    }
    expect(DEFAULT_PRESET).toBe('30d')
  })
  it('round-trips every preset through the URL', () => {
    for (const p of OVERVIEW_PRESETS) {
      expect(presetFromSearch(rangeSearch(p))).toBe(p)
      expect(analyticsStateFromSearch(rangeSearch(p), () => false)).toEqual({ preset: p, custom: null })
    }
  })
  it('writes the default out explicitly so a shared link never depends on defaults', () => {
    expect(rangeSearch('30d')).toBe('?range=30d')
  })
  it('the "View full analytics" link carries the chosen range', () => {
    expect(analyticsHref('7d')).toBe('/analytics?range=7d')
    expect(analyticsHref('all')).toBe('/analytics?range=all')
    expect(analyticsHref('custom', { from: '2026-01-01', to: '2026-01-31' })).toBe('/analytics?range=custom&from=2026-01-01&to=2026-01-31')
    expect(analyticsHref('custom', null)).toBe('/analytics?range=30d')
  })
  it('custom ranges in the URL are accepted only when valid', () => {
    const ok = (f: string, t: string) => validateCustom(f, t, today) === null
    expect(analyticsStateFromSearch('?range=custom&from=2026-01-01&to=2026-01-31', ok)).toEqual({ preset: 'custom', custom: { from: '2026-01-01', to: '2026-01-31' } })
    expect(analyticsStateFromSearch('?range=custom', ok)).toEqual({ preset: 'custom', custom: null })
    for (const bad of ['?range=custom&from=2026-01-01', '?range=custom&from=2026-02-01&to=2026-01-01', '?range=custom&from=2026-01-01&to=2027-01-01', '?range=custom&from=abc&to=def', '?range=custom&from=2026-02-30&to=2026-03-01']) {
      expect(analyticsStateFromSearch(bad, ok), bad).toEqual({ preset: '30d', custom: null })
    }
  })
  it('a custom range written to the URL reads back the same', () => {
    const c: DateRange = { from: '2026-03-01', to: '2026-03-31' }
    expect(analyticsStateFromSearch(rangeSearch('custom', c), (f, t) => isDate(f) && isDate(t))).toEqual({ preset: 'custom', custom: c })
  })
})

describe('one-sentence summary: every branch for every preset', () => {
  const days = { '7d': 7, '30d': 30, '90d': 90 } as const

  for (const p of ['7d', '30d', '90d'] as const) {
    describe(p, () => {
      const range = rangeOf(p)
      const line = (cur: Partial<Summary>, prev: Partial<Summary> | null) => summaryLine(sum(cur), prev ? sum(prev) : null, range)

      it('no ratings now: empty', () => {
        expect(line({ ratings: 0, avg_rating: null }, { ratings: 20 })).toEqual({ kind: 'empty', text: 'No ratings in this period yet.' })
        expect(line({ ratings: 0, avg_rating: null }, { ratings: 0, avg_rating: null }).kind).toBe('empty')
      })
      it('too few ratings in either period: no trend claimed', () => {
        expect(line({ ratings: 4, avg_rating: 5 }, { ratings: 20, avg_rating: 3 })).toEqual({ kind: 'small-sample', text: 'Not enough ratings yet to show a trend.' })
        expect(line({ ratings: 20, avg_rating: 5 }, { ratings: 4, avg_rating: 3 }).kind).toBe('small-sample')
        expect(line({ ratings: 20, avg_rating: 5 }, { ratings: 0, avg_rating: null }).kind).toBe('small-sample')
        expect(line({ ratings: 1, avg_rating: 5 }, { ratings: 1, avg_rating: 1 }).kind).toBe('small-sample')
      })
      it('exactly 5 ratings in both periods is enough', () => {
        expect(line({ ratings: 5, avg_rating: 4.5 }, { ratings: 5, avg_rating: 4.2 }).kind).toBe('up')
      })
      it('up', () => {
        expect(line({ avg_rating: 4.3 }, { avg_rating: 4 })).toEqual({ kind: 'up', text: `Average rating is up 0.3 vs the previous ${days[p]} days.` })
      })
      it('down', () => {
        expect(line({ avg_rating: 3.5 }, { avg_rating: 4.1 })).toEqual({ kind: 'down', text: `Average rating is down 0.6 vs the previous ${days[p]} days.` })
      })
      it('unchanged, including tiny changes that round away', () => {
        expect(line({ avg_rating: 4 }, { avg_rating: 4 })).toEqual({ kind: 'flat', text: `Average rating is unchanged vs the previous ${days[p]} days.` })
        expect(line({ avg_rating: 4.02 }, { avg_rating: 4 }).kind).toBe('flat')
        expect(line({ avg_rating: 3.97 }, { avg_rating: 4 }).kind).toBe('flat')
      })
      it('says the same as the arrow on the KPI card', () => {
        for (const [c, v] of [[4.3, 4], [3.5, 4.1], [4, 4], [4.04, 4], [4.05, 4]]) {
          const cur = sum({ avg_rating: c })
          const prev = sum({ avg_rating: v })
          const l = summaryLine(cur, prev, range)
          const t = buildTrends(cur, prev).avg
          expect(l.kind, `${c} vs ${v}`).toBe(t.direction)
          if (t.direction === 'up' || t.direction === 'down') expect(l.text).toContain(t.label.slice(1))
        }
      })
    })
  }

  describe('all time', () => {
    const range = rangeOf('all')
    it('has no previous period', () => {
      expect(prevOf('all')).toBeNull()
    })
    it('shows a clear "no comparison available" state when there are ratings', () => {
      const l = summaryLine(sum(), null, range)
      expect(l.kind).toBe('no-comparison')
      expect(l.text).toMatch(/no comparison/i)
      expect(l.text).not.toMatch(/up|down/i)
    })
    it('shows the empty state when there are no ratings at all', () => {
      expect(summaryLine(sum({ ratings: 0, avg_rating: null }), null, range).kind).toBe('empty')
    })
    it('never produces an arrow for any number', () => {
      const t = buildTrends(sum(), null)
      for (const v of Object.values(t)) expect(v.direction).toBe('none')
    })
  })

  it('previous-period label matches the real length of the range, for every preset', () => {
    expect(previousLabel(rangeOf('7d'))).toBe('previous 7 days')
    expect(previousLabel(rangeOf('30d'))).toBe('previous 30 days')
    expect(previousLabel(rangeOf('90d'))).toBe('previous 90 days')
  })

  it('every preset has the right previous period of the same length', () => {
    for (const p of ['7d', '30d', '90d'] as const) {
      const r = rangeOf(p)
      const pr = prevOf(p)!
      expect(pr.to < r.from).toBe(true)
      expect(previousLabel(pr)).toBe(previousLabel(r))
    }
  })
})

describe('headline trends (shared by Overview and Analytics)', () => {
  it('Overview and Analytics are built from the same function, so the same inputs give the same arrows', () => {
    const cur = sum({ ratings: 12, avg_rating: 4.4, page_views: 80 })
    const prev = sum({ ratings: 10, avg_rating: 4.0, page_views: 100 })
    const a = buildTrends(cur, prev)
    const b = buildTrends({ ...cur }, { ...prev })
    expect(a).toEqual(b)
    expect(a.ratings.direction).toBe('up')
    expect(a.avg.direction).toBe('up')
    expect(a.views.direction).toBe('down')
  })
  it('suppresses every arrow when either period has fewer than 5 ratings', () => {
    const t = buildTrends(sum({ ratings: 4 }), sum({ ratings: 50 }))
    for (const v of Object.values(t)) expect(v.direction).toBe('none')
  })
})
