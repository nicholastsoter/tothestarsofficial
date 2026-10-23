import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Field, Notice } from '../../components/ui/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useBusiness, type BusinessPatch } from '../../contexts/BusinessContext'
import { isHexColor } from '../../lib/color'
import { validateSlug } from '../../lib/slug'
import DeleteAccount from './DeleteAccount'
import GoogleListingPicker from './GoogleListingPicker'
import LogoUploader from './LogoUploader'

export default function SettingsPage() {
  const { business, loading, update } = useBusiness()
  const { user } = useAuth()
  const [alertsBusy, setAlertsBusy] = useState(false)
  const [alertsError, setAlertsError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [color, setColor] = useState('#2563eb')
  const [thanks, setThanks] = useState('')
  const [slug, setSlug] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // fill the form when the business loads (or changes elsewhere, e.g. the Google lookup renames it)
  useEffect(() => {
    if (!business) return
    setName(business.name)
    setAddress(business.address ?? '')
    setColor(business.brand_color)
    setThanks(business.thank_you_message)
    setSlug(business.slug)
  }, [business])

  if (loading) return <p className="text-sm text-slate-500" role="status">Loading…</p>
  if (!business) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-2 text-slate-600">Create your business on the <Link to="/dashboard" className="font-medium text-indigo-600">Dashboard</Link> first.</p>
      </div>
    )
  }

  const slugChanged = slug !== business.slug
  const alerts = business.alerts_enabled

  // saved straight away: it's a preference, not part of the form below
  async function onToggleAlerts(next: boolean) {
    setAlertsBusy(true)
    setAlertsError(null)
    const err = await update({ alerts_enabled: next })
    if (err) setAlertsError(err)
    setAlertsBusy(false)
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!business) return
    setSaved(false)
    setFormError(null)

    const errors: Record<string, string> = {}
    if (!name.trim() || name.length > 120) errors.name = 'Enter a name up to 120 characters.'
    if (address.length > 300) errors.address = 'Keep the address under 300 characters.'
    if (!isHexColor(color)) errors.color = 'Use a colour like #2563eb.'
    if (thanks.length > 500) errors.thanks = 'Keep the message under 500 characters.'
    const slugProblem = slugChanged ? validateSlug(slug) : null
    if (slugProblem) errors.slug = slugProblem
    setFieldErrors(errors)
    if (Object.keys(errors).length) return

    const patch: BusinessPatch = {}
    if (name.trim() !== business.name) patch.name = name.trim()
    if ((address.trim() || null) !== business.address) patch.address = address.trim() || null
    if (color.toLowerCase() !== business.brand_color.toLowerCase()) patch.brand_color = color.toLowerCase()
    if (thanks !== business.thank_you_message) patch.thank_you_message = thanks
    // the database trigger saves the old slug to slug_history, so printed QR codes keep working
    if (slugChanged) patch.slug = slug
    if (Object.keys(patch).length === 0) return setSaved(true)

    setSaving(true)
    const err = await update(patch)
    setSaving(false)
    if (!err) return setSaved(true)
    if (/link name/i.test(err)) setFieldErrors({ slug: err })
    else setFormError(err)
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card title="Business details">
        <form onSubmit={onSave} className="space-y-4" noValidate>
          <FieldError message={fieldErrors.name}><Field label="Business name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></FieldError>
          <FieldError message={fieldErrors.address}><Field label="Address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} /></FieldError>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Brand colour</span>
            <div className="flex items-center gap-3">
              <input type="color" aria-label="Pick a brand colour" value={isHexColor(color) ? color : '#2563eb'} onChange={(e) => setColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded border border-slate-300 bg-white p-1" />
              <input aria-label="Brand colour hex code" value={color} onChange={(e) => setColor(e.target.value)} maxLength={7} className="w-32 rounded-lg border-0 px-3 py-2.5 font-mono text-sm shadow-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-600 focus:outline-none" />
            </div>
            {fieldErrors.color && <p className="mt-1 text-xs text-red-700">{fieldErrors.color}</p>}
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Thank-you message</span>
            <textarea rows={3} maxLength={500} value={thanks} onChange={(e) => setThanks(e.target.value)} className="block w-full rounded-lg border-0 px-3 py-2.5 text-sm shadow-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-600 focus:outline-none" />
            <span className="mt-1 block text-xs text-slate-500">Shown at the bottom of your review page. {thanks.length}/500</span>
            {fieldErrors.thanks && <span className="block text-xs text-red-700">{fieldErrors.thanks}</span>}
          </label>

          <div>
            <Field label="Review page link name" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={50} autoComplete="off" spellCheck={false} />
            <p className="mt-1 break-all text-xs text-slate-500">Your page: {window.location.origin}/r/<strong>{slug || '…'}</strong></p>
            {fieldErrors.slug && <p className="mt-1 text-xs text-red-700">{fieldErrors.slug}</p>}
            {slugChanged && !fieldErrors.slug && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                Printed QR codes and old links will keep working: <strong>/r/{business.slug}</strong> will redirect to the new link. You’ll want to download a fresh QR code afterwards.
              </p>
            )}
          </div>

          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={alerts} onChange={(e) => void onToggleAlerts(e.target.checked)} disabled={alertsBusy} />
              <span>
                Email me when someone leaves a low rating (3 stars or fewer) with a message or survey answers
                <span className="mt-1 block text-xs text-slate-500">One email per feedback item, to {user?.email ?? 'your account email'}, and at most 10 an hour. Emails never include your customer’s contact details.</span>
              </span>
            </label>
            {alertsError && <p role="alert" className="mt-2 text-xs text-red-700">{alertsError}</p>}
          </div>

          {formError && <Notice tone="error">{formError}</Notice>}
          {saved && <Notice tone="success">Saved.</Notice>}
          <Button type="submit" className="!w-auto" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </form>
      </Card>

      <Card title="Logo" description="Shown on your review page and printed QR sign.">
        <LogoUploader />
      </Card>

      <Card title="Google listing" description="Connects your review page to your Google Business listing so happy customers can post a review.">
        <GoogleListingPicker />
      </Card>

      <DeleteAccount />
    </div>
  )
}

function FieldError({ message, children }: { message?: string; children: React.ReactNode }) {
  return (
    <div>
      {children}
      {message && <p className="mt-1 text-xs text-red-700">{message}</p>}
    </div>
  )
}
