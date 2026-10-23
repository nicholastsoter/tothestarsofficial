import { describe, expect, it } from 'vitest'
import { isHexColor, readableTextColor } from './color'
import { fitWithin } from './image'
import { googleReviewLink, publicReviewUrl } from './links'
import { RESERVED_SLUGS, slugify, suggestSlug, validateSlug } from './slug'
import { extraFor, firstMissingRequired, toAnswerPayload, type PublicQuestion } from './survey'

describe('slugs', () => {
  it('slugifies business names', () => {
    expect(slugify("Joe's Pizza & Pasta!")).toBe('joes-pizza-pasta')
    expect(slugify('  Café   Münster  ')).toBe('cafe-munster')
    expect(slugify('日本語')).toBe('')
    expect(slugify('a'.repeat(80)).length).toBe(40)
    expect(slugify('x'.repeat(39) + ' yyyy')).not.toMatch(/-$/)
  })

  it('always suggests a slug that passes validation', () => {
    for (const name of ['Joe', 'A', '', '日本語', 'Admin', 'Settings', 'API', "Joe's", '!!!', 'R', 'x'.repeat(200)]) {
      expect(validateSlug(suggestSlug(name)), name).toBeNull()
      expect(validateSlug(suggestSlug(name, 'k3m9')), `${name}+suffix`).toBeNull()
    }
  })

  it('rejects reserved, malformed, short and long slugs with a reason', () => {
    for (const bad of [...RESERVED_SLUGS].filter((s) => s.length >= 3)) expect(validateSlug(bad), bad).toMatch(/reserved/)
    expect(validateSlug('ab')).toMatch(/at least 3/)
    expect(validateSlug('r')).toMatch(/at least 3/)
    expect(validateSlug('a'.repeat(51))).toMatch(/at most 50/)
    for (const bad of ['Has-Caps', 'has_underscore', '-lead', 'trail-', 'dou--ble', 'sp ace', 'émoji']) expect(validateSlug(bad), bad).toMatch(/lowercase/)
    expect(validateSlug('joes-pizza-2')).toBeNull()
  })
})

describe('colour', () => {
  it('picks readable text colours', () => {
    expect(readableTextColor('#ffffff')).toBe('#000000')
    expect(readableTextColor('#000000')).toBe('#ffffff')
    expect(readableTextColor('#2563eb')).toBe('#ffffff')
    expect(readableTextColor('#facc15')).toBe('#000000')
    expect(readableTextColor('nonsense')).toBe('#000000')
  })
  it('validates hex colours', () => {
    expect(isHexColor('#12abEF')).toBe(true)
    for (const bad of ['12abef', '#12abe', '#12abefg', 'red']) expect(isHexColor(bad)).toBe(false)
  })
})

describe('links', () => {
  it('builds the Google review link only from a well-formed Place ID', () => {
    expect(googleReviewLink('ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe('https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4')
    for (const bad of [null, undefined, '', 'short', 'has space in it here', 'a&b=c-padding-padding']) expect(googleReviewLink(bad)).toBeNull()
  })
  it('builds the public page link, not the Google link', () => {
    expect(publicReviewUrl('joes-pizza', 'https://tothestars.app/')).toBe('https://tothestars.app/r/joes-pizza')
    expect(publicReviewUrl('joes-pizza', 'https://tothestars.app')).not.toContain('google')
  })
})

describe('image sizing', () => {
  it('caps the long side and keeps the aspect ratio', () => {
    expect(fitWithin(2000, 1000, 512)).toEqual({ width: 512, height: 256 })
    expect(fitWithin(1000, 4000, 512)).toEqual({ width: 128, height: 512 })
    expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200 })
    expect(fitWithin(10000, 1, 512)).toEqual({ width: 512, height: 1 })
  })
})

describe('survey helpers', () => {
  const qs: PublicQuestion[] = [
    { id: 'a', type: 'multiple_choice', prompt: 'A', options: ['x', 'y'], required: false },
    { id: 'b', type: 'short_text', prompt: 'B', options: null, required: true },
    { id: 'c', type: 'rating', prompt: 'C', options: null, required: false },
  ]
  it('shows the survey for 1-3 stars and the text box for 4-5', () => {
    expect([1, 2, 3].map(extraFor)).toEqual(['survey', 'survey', 'survey'])
    expect([4, 5].map(extraFor)).toEqual(['text', 'text'])
  })
  it('only complains about required questions once something is answered', () => {
    expect(firstMissingRequired(qs, {})).toBeNull()
    expect(firstMissingRequired(qs, { b: '   ' })).toBeNull()
    expect(firstMissingRequired(qs, { a: 'x' })).toBe('b')
    expect(firstMissingRequired(qs, { a: 'x', b: 'ok' })).toBeNull()
    expect(firstMissingRequired(qs, { c: 4 })).toBe('b')
  })
  it('sends only answered questions, trimmed', () => {
    expect(toAnswerPayload(qs, { a: 'x', b: '  hi  ', c: undefined })).toEqual([
      { question_id: 'a', answer: 'x' },
      { question_id: 'b', answer: 'hi' },
    ])
    expect(toAnswerPayload(qs, { b: '  ' })).toEqual([])
    expect(toAnswerPayload(qs, { c: 3 })).toEqual([{ question_id: 'c', answer: 3 }])
  })
})
