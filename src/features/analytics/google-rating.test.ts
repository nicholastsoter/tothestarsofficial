import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { asErrorCode, formatFetchedAgo, formatReviewCount, googleErrorMessage } from './googleFormat'

const here = import.meta.dirname
const read = (f: string) => readFileSync(join(here, f), 'utf8')
/** code only: comments may (and do) name the very things the code must not use */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const allSource = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? allSource(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : []
  })

describe('the live rating never touches browser storage', () => {
  const panelFiles = ['GoogleRatingContext.tsx', 'GoogleRatingPanel.tsx', 'googleFormat.ts']
  const FORBIDDEN = /localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|navigator\.storage|\.setItem\(|openDatabase/

  it.each(panelFiles)('%s has no storage code', (file) => {
    expect(code(file)).not.toMatch(FORBIDDEN)
  })

  it('is the only code that calls the google-rating function, and it keeps the value in React state', () => {
    const callers = allSource(join(here, '..', '..')).filter((f) => readFileSync(f, 'utf8').includes("'google-rating'"))
    expect(callers.map((f) => f.split('/').pop())).toEqual(['GoogleRatingContext.tsx'])
    expect(read('GoogleRatingContext.tsx')).toMatch(/useState</)
  })

  it('fetches once per page load, from the panel, and never from a timer', () => {
    const panel = code('GoogleRatingPanel.tsx')
    expect(panel).toContain('ensureLoaded')
    expect(panel).toMatch(/Refresh/)
    // the only timer on the panel just re-renders the "fetched ... ago" label; it never calls refresh()
    const intervals = panel.match(/setInterval\([\s\S]*?\)\s*\n/g) ?? []
    for (const i of intervals) expect(i).not.toMatch(/refresh|ensureLoaded|fetch/)
  })
})

describe('wording', () => {
  it('has a friendly message for every error, with the two cap messages as specified', () => {
    expect(googleErrorMessage('google_busy')).toBe('Google rating is busy, try again tomorrow.')
    expect(googleErrorMessage('business_cap')).toMatch(/reached today’s limit/)
    expect(googleErrorMessage('no_listing')).toMatch(/Connect your Google listing/)
    expect(googleErrorMessage('google_unavailable')).toMatch(/isn’t responding/)
    expect(googleErrorMessage('listing_not_found')).toMatch(/couldn’t find your listing/)
    for (const code of ['no_listing', 'no_business', 'business_cap', 'google_busy', 'google_unavailable', 'listing_not_found', 'unauthorized', 'unknown'] as const) {
      expect(googleErrorMessage(code).length, code).toBeGreaterThan(20)
      expect(googleErrorMessage(code)).not.toMatch(/error|exception|undefined|\{/i)
    }
  })
  it('maps unexpected codes to "unknown" instead of showing them', () => {
    expect(asErrorCode('google_busy')).toBe('google_busy')
    for (const v of ['<script>', undefined, 42, null, 'AIzaSy-key']) expect(asErrorCode(v)).toBe('unknown')
  })
  it('says how long ago the value was fetched', () => {
    const t = 1_000_000
    expect(formatFetchedAgo(t, t)).toBe('just now')
    expect(formatFetchedAgo(t + 44_000, t)).toBe('just now')
    expect(formatFetchedAgo(t + 60_000, t)).toBe('1 minute ago')
    expect(formatFetchedAgo(t + 5 * 60_000, t)).toBe('5 minutes ago')
    expect(formatFetchedAgo(t + 60 * 60_000, t)).toBe('1 hour ago')
    expect(formatFetchedAgo(t + 3 * 3_600_000, t)).toBe('3 hours ago')
    expect(formatFetchedAgo(t - 5000, t)).toBe('just now') // clock skew never shows a negative time
  })
  it('formats the review count', () => {
    expect(formatReviewCount(0)).toBe('No Google reviews yet')
    expect(formatReviewCount(1)).toBe('1 Google review')
    expect(formatReviewCount(1234)).toBe('1,234 Google reviews')
  })
})
