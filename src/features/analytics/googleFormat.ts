// Wording for the live Google rating panel. Pure functions, so every message is tested.

export type GoogleErrorCode = 'no_listing' | 'no_business' | 'business_cap' | 'google_busy' | 'google_unavailable' | 'listing_not_found' | 'unauthorized' | 'unknown'

const KNOWN: GoogleErrorCode[] = ['no_listing', 'no_business', 'business_cap', 'google_busy', 'google_unavailable', 'listing_not_found', 'unauthorized']
export const asErrorCode = (v: unknown): GoogleErrorCode => (KNOWN as unknown[]).includes(v) ? (v as GoogleErrorCode) : 'unknown'

export function googleErrorMessage(code: GoogleErrorCode): string {
  switch (code) {
    case 'no_listing':
    case 'no_business':
      return 'Connect your Google listing in Settings to see your live Google rating.'
    case 'business_cap':
      return 'You’ve reached today’s limit for checking your Google rating. It resets tomorrow.'
    case 'google_busy':
      return 'Google rating is busy, try again tomorrow.'
    case 'google_unavailable':
      return 'Google isn’t responding right now. Please try again in a few minutes.'
    case 'listing_not_found':
      return 'Google couldn’t find your listing. Reconnect it in Settings.'
    case 'unauthorized':
      return 'Your session expired. Please log in again.'
    default:
      return 'We couldn’t check your Google rating just now. Please try again.'
  }
}

/** "just now", "3 minutes ago", "2 hours ago": how long ago the value was fetched. */
export function formatFetchedAgo(now: number, then: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return m <= 1 ? '1 minute ago' : `${m} minutes ago`
  const h = Math.round(m / 60)
  return h === 1 ? '1 hour ago' : `${h} hours ago`
}

export function formatReviewCount(n: number): string {
  if (n <= 0) return 'No Google reviews yet'
  return `${new Intl.NumberFormat('en-US').format(n)} Google ${n === 1 ? 'review' : 'reviews'}`
}
