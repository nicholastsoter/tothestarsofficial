import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthCard, Button, Field, Notice, TextLink } from '../../components/ui/ui'
import { supabase } from '../../lib/supabase'
import { getBrowserTimeZone } from '../../lib/timezone'

export const MIN_PASSWORD_LENGTH = 8

export default function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        // Saved on the account so onboarding can create the business in the owner's time zone.
        data: { timezone: getBrowserTimeZone() },
      },
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    // With email confirmation on there is no session yet; the user must click the emailed link.
    if (data.session) navigate('/dashboard', { replace: true })
    else navigate('/verify-email', { replace: true, state: { email: email.trim() } })
  }

  return (
    <AuthCard title="Create your account" subtitle="Start collecting reviews in a few minutes.">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Sign up'}
        </Button>
      </form>
      <p className="text-center text-sm text-slate-600">
        Already have an account? <TextLink to="/login">Log in</TextLink>
      </p>
    </AuthCard>
  )
}
