import { useRef, useState } from 'react'
import { Button, Notice } from '../../components/ui/ui'
import { useBusiness } from '../../contexts/BusinessContext'
import { LogoError, prepareLogo } from '../../lib/image'
import { supabase } from '../../lib/supabase'

const BUCKET = 'logos'

export default function LogoUploader() {
  const { business, update } = useBusiness()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!business) return null

  /** delete every file in this business's folder except `keep` */
  async function cleanFolder(businessId: string, keep?: string) {
    const { data } = await supabase.storage.from(BUCKET).list(businessId)
    const stale = (data ?? []).map((f) => `${businessId}/${f.name}`).filter((p) => p !== keep)
    if (stale.length) await supabase.storage.from(BUCKET).remove(stale)
  }

  async function onPick(file: File | undefined) {
    if (!file || !business) return
    setError(null)
    setBusy(true)
    try {
      const { blob, type, ext } = await prepareLogo(file)
      // files live under {business_id}/; the storage rules only allow your own folder
      const path = `${business.id}/logo-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false })
      if (upErr) throw new LogoError('The upload failed. Please try again.')

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      const err = await update({ logo_url: data.publicUrl })
      if (err) throw new LogoError(err)
      await cleanFolder(business.id, path)
    } catch (e) {
      setError(e instanceof LogoError ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function remove() {
    if (!business) return
    setBusy(true)
    setError(null)
    const err = await update({ logo_url: null })
    if (err) setError(err)
    else await cleanFolder(business.id)
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
          {business.logo_url ? (
            <img src={business.logo_url} alt="Your logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-slate-400">No logo</span>
          )}
        </div>
        <div className="space-y-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="logo-file" onChange={(e) => onPick(e.target.files?.[0])} disabled={busy} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="!w-auto" onClick={() => input.current?.click()} disabled={busy}>
              {busy ? 'Working…' : business.logo_url ? 'Replace logo' : 'Upload logo'}
            </Button>
            {business.logo_url && (
              <Button type="button" variant="secondary" className="!w-auto" onClick={remove} disabled={busy}>
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">PNG, JPG or WebP. Large images are resized to 512 px; the result must be under 2 MB.</p>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}
