import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, CopyButton, Notice } from '../../components/ui/ui'
import { useBusiness } from '../../contexts/BusinessContext'
import { publicReviewUrl } from '../../lib/links'
import { buildSignPdf, dataUrlToBlob, downloadBlob, qrPng, qrSvg } from './qrExports'

export default function QrPage() {
  const { business, loading, update } = useBusiness()
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'png' | 'svg' | 'pdf'>(null)
  const [error, setError] = useState<string | null>(null)

  // the link customers scan: the review PAGE on this site, never the Google link
  const link = business ? publicReviewUrl(business.slug) : null

  useEffect(() => {
    if (!link) return
    let cancelled = false
    qrPng(link).then((url) => !cancelled && setPreview(url))
    return () => { cancelled = true }
  }, [link])

  if (loading) return <p className="text-sm text-slate-500" role="status">Loading…</p>
  if (!business || !link) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">QR & Link</h1>
        <p className="mt-2 text-slate-600">Create your business on the <Link to="/dashboard" className="font-medium text-indigo-600">Dashboard</Link> first.</p>
      </div>
    )
  }

  async function download(kind: 'png' | 'svg' | 'pdf') {
    if (!business || !link) return
    setBusy(kind)
    setError(null)
    try {
      const base = `${business.slug}-review-qr`
      if (kind === 'png') downloadBlob(await dataUrlToBlob(await qrPng(link)), `${base}.png`)
      else if (kind === 'svg') downloadBlob(new Blob([await qrSvg(link)], { type: 'image/svg+xml' }), `${base}.svg`)
      else downloadBlob(await buildSignPdf({ name: business.name, link, color: business.brand_color, logoUrl: business.logo_url }), `${base}-sign.pdf`)
      // onboarding step 4 is "done" once anything has been downloaded
      if (!business.qr_downloaded_at) await update({ qr_downloaded_at: new Date().toISOString() })
    } catch {
      setError('Something went wrong creating that file. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">QR & Link</h1>

      {!business.place_id && (
        <Notice tone="info">
          Your QR code works, but customers won’t see a Google review button until you <Link to="/settings" className="font-medium text-indigo-600 underline">connect your Google listing</Link>.
        </Notice>
      )}

      <Card>
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-xl bg-white p-2 ring-1 ring-slate-200">
            {preview ? <img src={preview} alt={`QR code that opens ${link}`} className="h-64 w-64" /> : <div className="h-64 w-64 animate-pulse rounded bg-slate-100" />}
          </div>

          <div className="w-full space-y-2">
            <label htmlFor="share-link" className="text-sm font-medium">Shareable link</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input id="share-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-300" />
              <CopyButton text={link} />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Download" description="Print the sign for your counter or tables, or use the QR image on your own materials.">
        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" disabled={busy !== null} onClick={() => download('png')}>{busy === 'png' ? 'Preparing…' : 'PNG image'}</Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => download('svg')}>{busy === 'svg' ? 'Preparing…' : 'SVG (scalable)'}</Button>
          <Button disabled={busy !== null} onClick={() => download('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Printable sign (PDF)'}</Button>
        </div>
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      </Card>
    </div>
  )
}
