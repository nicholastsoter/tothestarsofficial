const PLACE_ID = /^[A-Za-z0-9_-]{10,200}$/

/** The Google "write a review" link for a business, or null if the Place ID is missing or odd. */
export function googleReviewLink(placeId: string | null | undefined): string | null {
  if (!placeId || !PLACE_ID.test(placeId)) return null
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

/** The public page customers scan to. Set VITE_PUBLIC_BASE_URL once you have a real domain. */
export function publicReviewUrl(slug: string, base: string = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin): string {
  return `${base.replace(/\/+$/, '')}/r/${slug}`
}
