import { FunctionsHttpError } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { Button, CopyButton, Field, Notice } from '../../components/ui/ui'
import { useBusiness } from '../../contexts/BusinessContext'
import { googleReviewLink } from '../../lib/links'
import { supabase } from '../../lib/supabase'

interface Result {
  place_id: string
  name: string
  address: string
}

const sessionId = () => crypto.randomUUID().replace(/-/g, '')

async function describeSearchError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const status = error.context.status
    if (status === 429) {
      const code = await error.context.json().then((b: { error?: string }) => b.error).catch(() => undefined)
      if (code === 'search_busy') return 'Search is busy right now. Please try again tomorrow, or come back to this step later.'
      return 'You’ve searched a lot in the past hour. Please wait a bit and try again.'
    }
    if (status === 401) return 'Your session expired. Please log in again.'
  }
  return 'Google search isn’t available right now. Please try again in a moment.'
}

export default function GoogleListingPicker() {
  const { business, update } = useBusiness()
  const [changing, setChanging] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Result | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const session = useRef(sessionId())
  const latestRequest = useRef(0)

  // search 350 ms after the owner stops typing
  useEffect(() => {
    const q = query.trim()
    if (selected || q.length < 3) {
      setResults(null)
      setSearching(false)
      setError(null)
      return
    }
    const id = ++latestRequest.current
    setSearching(true)
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke('places-search', { body: { query: q, sessionToken: session.current } })
      if (id !== latestRequest.current) return // a newer search replaced this one
      setSearching(false)
      if (error) {
        setError(await describeSearchError(error))
        setResults(null)
      } else {
        setError(null)
        setResults((data as { results: Result[] }).results)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, selected])

  if (!business) return null
  const link = googleReviewLink(business.place_id)

  function pick(r: Result) {
    setSelected(r)
    setName(r.name)
    setAddress(r.address)
    setSaveError(null)
  }

  async function save() {
    if (!selected) return
    setSaving(true)
    setSaveError(null)
    const err = await update({ place_id: selected.place_id, name: name.trim() || selected.name, address: address.trim() || null })
    setSaving(false)
    if (err) return setSaveError(err)
    setSelected(null)
    setQuery('')
    setChanging(false)
    session.current = sessionId() // a finished search ends its billing session
  }

  const showSearch = !link || changing

  return (
    <div className="space-y-4">
      {link && (
        <div className="space-y-2">
          <Notice tone="success">Google listing connected.</Notice>
          <p className="text-sm font-medium">Your Google review link</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input readOnly value={link} aria-label="Google review link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-300" />
            <CopyButton text={link} />
          </div>
          <p className="text-xs text-slate-500">Customers are sent to this link from your review page. You don’t need to share it directly.</p>
          {!changing && (
            <button type="button" onClick={() => setChanging(true)} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
              Change listing
            </button>
          )}
        </div>
      )}

      {showSearch && (
        <div className="space-y-3">
          {!selected && (
            <>
              <Field
                label="Search for your business"
                placeholder="Business name and city"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                hint="Type at least 3 characters. We only keep the listing’s ID, not its ratings or reviews."
              />
              {searching && <p className="text-sm text-slate-500" role="status">Searching…</p>}
              {error && <Notice tone="error">{error}</Notice>}
              {results && results.length === 0 && !searching && (
                <Notice tone="info">No matches. Try your business name plus the city, or check the spelling.</Notice>
              )}
              {results && results.length > 0 && (
                <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg ring-1 ring-slate-200">
                  {results.map((r) => (
                    <li key={r.place_id}>
                      <button type="button" onClick={() => pick(r)} className="block w-full px-3 py-2.5 text-left hover:bg-slate-50">
                        <span className="block text-sm font-medium">{r.name}</span>
                        <span className="block text-xs text-slate-500">{r.address}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {(results || searching) && <p className="text-xs text-slate-500">Powered by Google</p>}
              {changing && (
                <button type="button" onClick={() => { setChanging(false); setQuery('') }} className="text-sm text-slate-600 underline">
                  Cancel
                </button>
              )}
            </>
          )}

          {selected && (
            <div className="space-y-3 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-sm font-medium">Confirm your business details</p>
              <Field label="Business name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              <Field label="Address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
              {saveError && <Notice tone="error">{saveError}</Notice>}
              <div className="flex gap-2">
                <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Use this listing'}</Button>
                <Button variant="secondary" onClick={() => setSelected(null)} disabled={saving}>Back</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
