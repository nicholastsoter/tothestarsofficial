import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, CopyButton, Field, Notice } from '../../components/ui/ui'
import { useBusiness } from '../../contexts/BusinessContext'
import { publicReviewUrl } from '../../lib/links'
import GoogleListingPicker from '../settings/GoogleListingPicker'
import LogoUploader from '../settings/LogoUploader'
import Overview from '../analytics/Overview'

export default function DashboardPage() {
  const { business, loading, loadError, create } = useBusiness()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  if (loading) return <p className="text-sm text-slate-500" role="status">Loading…</p>
  if (loadError) return <Notice tone="error">{loadError}</Notice>

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCreating(true)
    const err = await create(name)
    setCreating(false)
    if (err) setError(err)
  }

  // each step is "done" because of real data, not because someone clicked a box
  const steps = [
    { key: 'name', title: 'Name your business', done: !!business },
    { key: 'google', title: 'Find your Google listing', done: !!business?.place_id },
    { key: 'logo', title: 'Upload your logo', done: !!business?.logo_url },
    { key: 'qr', title: 'Download your QR code', done: !!business?.qr_downloaded_at },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const current = open ?? steps.find((s) => !s.done)?.key ?? null

  const body: Record<string, ReactNode> = {
    name: (
      <form onSubmit={onCreate} className="space-y-3">
        <Field label="Business name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Joe’s Pizza" required />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="!w-auto" disabled={creating || !name.trim()}>{creating ? 'Creating…' : 'Continue'}</Button>
      </form>
    ),
    google: <GoogleListingPicker />,
    logo: <LogoUploader />,
    qr: (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Get your QR code as an image or a printable counter sign.</p>
        <Link to="/qr" className="inline-block rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Open QR & Link</Link>
      </div>
    ),
  }

  const complete = !!business && doneCount === steps.length

  // Once setup is finished the Overview takes over the top; the checklist only shows while steps are left.
  if (complete) {
    return (
      <div className="space-y-6">
        <Overview />
        <div className="max-w-5xl">
          <Card title="Your review page">
            <p className="text-sm text-slate-600">Put the QR sign where customers will see it.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input readOnly aria-label="Review page link" value={publicReviewUrl(business.slug)} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-300" />
              <CopyButton text={publicReviewUrl(business.slug)} />
              <a href={publicReviewUrl(business.slug)} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white px-3 py-2 text-center text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Preview</a>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{business ? `Welcome, ${business.name}` : 'Welcome!'}</h1>
        <p className="mt-1 text-slate-600">Four quick steps and you’re ready to collect reviews.</p>
      </div>

      <Card>
        <div className="mb-4">
          <div className="flex justify-between text-sm font-medium">
            <span>Setup progress</span>
            <span>{doneCount} of {steps.length}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
            <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
        </div>

        <ol className="divide-y divide-slate-200">
          {steps.map((s, i) => {
            const locked = !business && s.key !== 'name'
            const expanded = current === s.key && !locked
            return (
              <li key={s.key} className="py-3">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setOpen(expanded ? '' : s.key)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    aria-hidden
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${s.done ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {s.done ? '✓' : i + 1}
                  </span>
                  <span className={`flex-1 text-sm font-medium ${s.done ? 'text-slate-500 line-through' : ''}`}>{s.title}</span>
                  <span className="sr-only">{s.done ? 'Done' : 'Not done'}</span>
                </button>
                {expanded && <div className="mt-3 pl-10">{body[s.key]}</div>}
              </li>
            )
          })}
        </ol>
      </Card>

    </div>
  )
}
