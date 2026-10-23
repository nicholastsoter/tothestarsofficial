import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthCard, Button, Field, Notice, TextLink } from '../../components/ui/ui'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { FullPageSpinner } from './guards'
import { MIN_PASSWORD_LENGTH } from './SignupPage'

export default function ResetPasswordPage() {
  const { user, loading, recovering } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <FullPageSpinner />

  // Only people who followed the emailed link (a recovery session) may set a new password here.
  if (!user || !recovering) {
    return (
      <AuthCard title="Link expired or invalid" subtitle="Password reset links work once and expire quickly.">
        <TextLink to="/forgot-password">Request a new link</TextLink>
      </AuthCard>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else navigate('/dashboard', { replace: true })
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Update password'}
        </Button>
      </form>
    </AuthCard>
  )
}
