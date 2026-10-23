import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AuthCard, Button, Field, Notice, TextLink } from '../../components/ui/ui'
import { supabase } from '../../lib/supabase'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const navState = location.state as { from?: string } | null
  const from = navState?.from ?? '/dashboard'
  const [deleted] = useState(() => {
    try {
      const flag = sessionStorage.getItem('accountDeleted') === '1'
      sessionStorage.removeItem('accountDeleted')
      return flag
    } catch {
      return false
    }
  })

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [resent, setResent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setUnverified(false)
    setResent(false)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (!error) {
      navigate(from, { replace: true })
    } else if (error.code === 'email_not_confirmed') {
      setUnverified(true)
    } else {
      // Same message for "no such user" and "wrong password" so the form can't be used
      // to discover which emails have accounts.
      setError('Incorrect email or password.')
    }
  }

  async function resend() {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    if (error) setError(error.message)
    else setResent(true)
  }

  return (
    <AuthCard title="Welcome back">
      <form onSubmit={onSubmit} className="space-y-4">
        {deleted && <Notice tone="success">Your account and data have been deleted.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {unverified && (
          <Notice tone="info">
            Please verify your email first. Check your inbox for the link, or{' '}
            <button type="button" onClick={resend} className="font-medium text-indigo-600 underline">
              send it again
            </button>
            .{resent && ' Sent!'}
          </Notice>
        )}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <div className="flex justify-between text-sm">
        <TextLink to="/forgot-password">Forgot password?</TextLink>
        <TextLink to="/signup">Create account</TextLink>
      </div>
    </AuthCard>
  )
}
