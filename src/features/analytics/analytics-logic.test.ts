import { describe, expect, it } from 'vitest'
import { addDays, allowedBuckets, defaultBucket, diffDays, formatBucket, formatRange, isDate, presetRange, previousRange, rangeLength, validateCustom } from './ranges'
import { MIN_RATINGS_FOR_TREND, clickThroughRate, formatAvg, formatInt, formatPercent, goalProgress, parseGoal, trend } from './trend'

describe('date maths (plain days, no time zones involved)', () => {
  it('adds days across month, year and leap-year boundaries', () => {
    expect(addDays('2025-01-31', 1)).toBe('2025-02-01')
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01')
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28')
    expect(addDays('2026-03-08', 0)).toBe('2026-03-08')
  })
  it('counts days between dates, and range lengths are inclusive', () => {
    expect(diffDays('2025-03-01', '2025-03-31')).toBe(30)
    expect(diffDays('2025-03-31', '2025-03-01')).toBe(-30)
    expect(rangeLength({ from: '2025-03-01', to: '2025-03-01' })).toBe(1)
    expect(rangeLength({ from: '2025-03-01', to: '2025-03-31' })).toBe(31)
    expect(diffDays('2025-03-08', '2025-03-10')).toBe(2) // the daylight-saving day is still one calendar day
  })
  it('recognises real dates only', () => {
    expect(isDate('2025-02-28')).toBe(true)
    for (const bad of ['2025-02-30', '2025-13-01', '25-01-01', 'yesterday', '', '2025-2-1']) expect(isDate(bad), bad).toBe(false)
  })
})

describe('presets and previous periods', () => {
  const today = '2026-10-23'
  it('last N days includes today and spans exactly N days', () => {
    expect(presetRange('7d', today, null)).toEqual({ from: '2026-10-17', to: today })
    expect(presetRange('30d', today, null)).toEqual({ from: '2026-09-24', to: today })
    expect(presetRange('90d', today, null)).toEqual({ from: '2026-07-26', to: today })
    for (const p of ['7d', '30d', '90d'] as const) expect(rangeLength(presetRange(p, today, null))).toBe(p === '7d' ? 7 : p === '30d' ? 30 : 90)
  })
  it('all time starts at the first data (or today if there is none, or the date is somehow in the future)', () => {
    expect(presetRange('all', today, '2026-03-02')).toEqual({ from: '2026-03-02', to: today })
    expect(presetRange('all', today, null)).toEqual({ from: today, to: today })
    expect(presetRange('all', today, '2030-01-01')).toEqual({ from: today, to: today })
  })
  it('the previous period is the same length, directly before, with no gap or overlap', () => {
    const cur = presetRange('30d', today, null)
    const prev = previousRange(cur, '30d')!
    expect(rangeLength(prev)).toBe(30)
    expect(addDays(prev.to, 1)).toBe(cur.from)
    const custom = previousRange({ from: '2026-03-01', to: '2026-03-10' }, 'custom')!
    expect(custom).toEqual({ from: '2026-02-19', to: '2026-02-28' })
  })
  it('all time has nothing to compare with', () => {
    expect(previousRange({ from: '2026-01-01', to: today }, 'all')).toBeNull()
  })
})

describe('buckets', () => {
  const r = (n: number) => ({ from: '2026-01-01', to: addDays('2026-01-01', n - 1) })
  it('picks a sensible default by range length', () => {
    expect([r(7), r(31), r(32), r(90), r(120), r(121), r(365)].map(defaultBucket)).toEqual(['day', 'day', 'week', 'week', 'week', 'month', 'month'])
  })
  it('does not offer buckets that would make an unreadable chart', () => {
    expect(allowedBuckets(r(7))).toEqual(['day', 'week'])
    expect(allowedBuckets(r(30))).toEqual(['day', 'week', 'month'])
    expect(allowedBuckets(r(365))).toEqual(['week', 'month'])
    expect(allowedBuckets(r(2000))).toEqual(['month'])
  })
  it('labels axes without drifting by a day in any browser time zone', () => {
    expect(formatBucket('2025-03-09', 'day')).toBe('Mar 9')
    expect(formatBucket('2025-03-03', 'week')).toBe('Mar 3')
    expect(formatBucket('2025-01-01', 'month')).toBe('Jan 2025')
    expect(formatRange({ from: '2025-03-09', to: '2025-03-09' })).toBe('Mar 9, 2025')
    expect(formatRange({ from: '2025-03-01', to: '2025-03-31' })).toBe('Mar 1, 2025 – Mar 31, 2025')
  })
})

describe('custom range validation', () => {
  const today = '2026-10-23'
  it('accepts a sensible range and rejects the rest with a reason', () => {
    expect(validateCustom('2026-10-01', '2026-10-23', today)).toBeNull()
    expect(validateCustom('', '2026-10-23', today)).toMatch(/both dates/)
    expect(validateCustom('2026-10-23', '2026-10-01', today)).toMatch(/on or before/)
    expect(validateCustom('2026-10-01', '2026-10-24', today)).toMatch(/future/)
    expect(validateCustom('2000-01-01', '2026-10-23', today)).toMatch(/10 years/)
    expect(validateCustom('2026-02-30', '2026-03-01', today)).toMatch(/both dates/)
  })
})

describe('trend arrows', () => {
  const enough = { curRatings: 20, prevRatings: 18 }
  it('shows no arrow, and says why, with fewer than 5 ratings in either period', () => {
    for (const small of [{ curRatings: 4, prevRatings: 50 }, { curRatings: 50, prevRatings: 4 }, { curRatings: 0, prevRatings: 0 }]) {
      const t = trend(4.5, 4.0, { kind: 'average', ...small })
      expect(t.direction).toBe('none')
      expect(t.reason).toMatch(/at least 5/)
    }
    expect(trend(4.5, 4.0, { kind: 'average', curRatings: MIN_RATINGS_FOR_TREND, prevRatings: MIN_RATINGS_FOR_TREND }).direction).toBe('up')
  })
  it('says there is nothing to compare with when there is no previous period', () => {
    expect(trend(4.5, null, { kind: 'average', curRatings: 50, prevRatings: null })).toMatchObject({ direction: 'none', reason: expect.stringMatching(/earlier period/) })
  })
  it('compares averages in tenths and calls tiny moves flat', () => {
    expect(trend(4.5, 4.0, { kind: 'average', ...enough })).toEqual({ direction: 'up', label: '+0.5' })
    expect(trend(3.8, 4.4, { kind: 'average', ...enough })).toEqual({ direction: 'down', label: '−0.6' })
    expect(trend(4.31, 4.28, { kind: 'average', ...enough }).direction).toBe('flat')
  })
  it('compares counts as percentages, including from zero', () => {
    expect(trend(120, 100, { kind: 'count', ...enough })).toEqual({ direction: 'up', label: '+20%' })
    expect(trend(60, 100, { kind: 'count', ...enough })).toEqual({ direction: 'down', label: '−40%' })
    expect(trend(100, 100, { kind: 'count', ...enough }).direction).toBe('flat')
    expect(trend(5, 0, { kind: 'count', ...enough })).toEqual({ direction: 'up', label: 'up from 0' })
    expect(trend(0, 0, { kind: 'count', ...enough }).direction).toBe('flat')
  })
  it('compares rates in percentage points', () => {
    expect(trend(0.35, 0.3, { kind: 'rate', ...enough })).toEqual({ direction: 'up', label: '+5.0 pts' })
    expect(trend(0.2, 0.3, { kind: 'rate', ...enough })).toEqual({ direction: 'down', label: '−10.0 pts' })
    expect(trend(0.301, 0.3, { kind: 'rate', ...enough }).direction).toBe('flat')
  })
  it('gives no arrow when a value is missing', () => {
    expect(trend(null, 4, { kind: 'average', ...enough }).direction).toBe('none')
  })
})

describe('formatting and rates', () => {
  it('computes click-through as clicks over page views, and not at all without views', () => {
    expect(clickThroughRate(25, 100)).toBe(0.25)
    expect(clickThroughRate(5, 0)).toBeNull()
    expect(clickThroughRate(0, 10)).toBe(0)
  })
  it('formats numbers', () => {
    expect(formatInt(1284)).toBe('1,284')
    expect(formatAvg(4.666)).toBe('4.7')
    expect(formatAvg(4.666, 2)).toBe('4.67')
    expect(formatAvg(null)).toBe('–')
    expect(formatPercent(0.254)).toBe('25%')
    expect(formatPercent(0.034)).toBe('3.4%')
    expect(formatPercent(null)).toBe('–')
  })
})

describe('goal', () => {
  it('measures progress as average over goal, capped at 100%', () => {
    expect(goalProgress(4.0, 4.5)).toBeCloseTo(0.889, 3)
    expect(goalProgress(4.8, 4.5)).toBe(1)
    expect(goalProgress(null, 4.5)).toBeNull()
    expect(goalProgress(4, null)).toBeNull()
  })
  it('accepts 1.0 to 5.0 with one decimal, and blank to clear', () => {
    expect(parseGoal('4.5')).toEqual({ value: 4.5 })
    expect(parseGoal('5')).toEqual({ value: 5 })
    expect(parseGoal(' 1.0 ')).toEqual({ value: 1 })
    expect(parseGoal('')).toEqual({ value: null })
    for (const bad of ['0.9', '5.1', '6', '4.55', 'abc', '-3', '4,5']) expect(parseGoal(bad), bad).toHaveProperty('error')
  })
})
