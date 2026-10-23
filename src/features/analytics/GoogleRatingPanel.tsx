import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBusiness } from '../../contexts/BusinessContext'
import { useGoogleRating } from './GoogleRatingContext'
import { formatFetchedAgo, formatReviewCount, googleErrorMessage } from './googleFormat'

/** "Google Maps" in the style Google asks for when its data appears without a map. */
export function GoogleAttribution() {
  return (
    <span translate="no" style={{ fontFamily: 'Roboto, Arial, sans-serif', fontWeight: 400, fontSize: 13, color: '#5E5E5E', whiteSpace: 'nowrap' }}>
      Google Maps
    </span>
  )
}

/** The business's live rating on Google. Fetched once when the page opens, refreshed on request, never saved. */
export default function GoogleRatingPanel() {
  const { business } = useBusiness()
  const g = useGoogleRating()
  const hasListing = Boolean(business?.place_id)

  useEffect(() => {
    if (hasListing) g.ensureLoaded()
  }, [hasListing, g])

  // re-render every 30 seconds so "fetched 2 minutes ago" stays honest
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const hasValue = g.fetchedAt !== null
  const loading = g.status === 'loading'

  return (
    // a bordered card on its own, so Google's content is visually separate from ours
    <section aria-labelledby="google-rating-h" className="viz rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-300 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="google-rating-h" className="text-sm font-semibold" style={{ color: 'var(--viz-text)' }}>Your rating on Google</h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--viz-text-2)' }}>Live from Google, not saved by us. This is your public rating, not the customers who used your review page.</p>
        </div>
        {hasListing && (
          <button type="button" onClick={() => void g.refresh()} disabled={loading} className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50">
            {loading ? 'Checking…' : 'Refresh'}
          </button>
        )}
      </div>

      {!hasListing ? (
        <p className="mt-3 text-sm text-slate-600">
          {googleErrorMessage('no_listing').replace(' in Settings', '')} <Link to="/settings" className="font-medium text-indigo-600 underline">Open Settings</Link>
        </p>
      ) : (
        <div className="mt-3">
          {hasValue ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {g.rating !== null ? (
                <p className="text-3xl font-semibold" style={{ color: 'var(--viz-text)' }}>{g.rating.toFixed(1)}<span aria-hidden className="text-xl" style={{ color: '#eda100' }}> ★</span><span className="sr-only"> out of 5 stars</span></p>
              ) : (
                <p className="text-sm text-slate-600">Google hasn’t published a rating for your listing yet.</p>
              )}
              <p className="text-sm" style={{ color: 'var(--viz-text-2)' }}>{formatReviewCount(g.reviewCount)}</p>
            </div>
          ) : loading ? (
            <p className="text-sm text-slate-500" role="status">Checking Google…</p>
          ) : null}

          {hasValue && <p className="mt-1 text-xs" style={{ color: 'var(--viz-text-2)' }}>Fetched {formatFetchedAgo(now, g.fetchedAt!)}</p>}
          {g.error && <p role="alert" className="mt-2 text-sm text-red-700">{googleErrorMessage(g.error)}{(g.error === 'listing_not_found') && <> <Link to="/settings" className="font-medium underline">Open Settings</Link></>}</p>}
          {!hasValue && !loading && !g.error && g.status === 'idle' && <p className="text-sm text-slate-500">Checking…</p>}
        </div>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: 'var(--viz-text-2)' }}>
        <span>Data from</span><GoogleAttribution />
      </p>
    </section>
  )
}
