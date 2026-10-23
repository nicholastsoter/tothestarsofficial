import { useState, type FormEvent } from 'react'
import { AuthCard, Button, Field, Notice, TextLink } from '../../components/ui/ui'
import { supabase } from '../../lib/supabase'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    // Supabase answers the same way whether or not the email has an account, so this form
    // can't be used to find out who is registered. Only real failures (e.g. rate limit) show.
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we'll send you a reset link.">
      {sent ? (
        <Notice tone="success">If an account exists for that email, a reset link is on its way.</Notice>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <p className="text-center text-sm text-slate-600">
        <TextLink to="/login">Back to log in</TextLink>
      </p>
    </AuthCard>
  )
}
