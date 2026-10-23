import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Field, Notice } from '../../components/ui/ui'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

export default function DeleteAccount() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const email = user?.email ?? ''
  const matches = email !== '' && typed.trim().toLowerCase() === email.toLowerCase()

  async function onDelete() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: typed.trim() } })
    if (error) {
      setBusy(false)
      return setError('We couldn’t delete your account. Nothing has been lost, so please try again.')
    }
    // the route guard redirects to /login the moment we sign out and would drop router state,
    // so the "deleted" message travels in session storage instead
    try { sessionStorage.setItem('accountDeleted', '1') } catch { /* storage unavailable: skip the notice */ }
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <Card tone="danger" title="Delete my account and data" description="Permanently deletes your account, business, logo, survey, all customer feedback and all analytics. This cannot be undone.">
      {!open ? (
        <Button variant="secondary" className="!w-auto !text-red-700" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      ) : (
        <div className="space-y-3">
          <Field label={`Type your email (${email}) to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex gap-2">
            <Button className="!w-auto !bg-red-600 hover:!bg-red-500 disabled:!bg-red-300" disabled={!matches || busy} onClick={onDelete}>
              {busy ? 'Deleting…' : 'Permanently delete everything'}
            </Button>
            <Button variant="secondary" className="!w-auto" disabled={busy} onClick={() => { setOpen(false); setTyped('') }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
