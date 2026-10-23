import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AuthCard, Button, Notice, TextLink } from '../../components/ui/ui'
import { supabase } from '../../lib/supabase'

export default function VerifyEmailPage() {
  const email = (useLocation().state as { email?: string } | null)?.email
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function resend() {
    if (!email) return
    setStatus('sending')
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) {
      setStatus('error')
      setMessage(error.message)
    } else {
      setStatus('sent')
    }
  }

  return (
    <AuthCard title="Check your email" subtitle={email ? `We sent a verification link to ${email}.` : 'We sent you a verification link.'}>
      <p className="text-sm text-slate-600">Click the link in that email to activate your account. It can take a minute to arrive; check spam too.</p>
      {status === 'sent' && <Notice tone="success">Sent again. Check your inbox.</Notice>}
      {status === 'error' && <Notice tone="error">{message}</Notice>}
      {email && (
        <Button variant="secondary" onClick={resend} disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Resend email'}
        </Button>
      )}
      <p className="text-center text-sm text-slate-600">
        Already verified? <TextLink to="/login">Log in</TextLink>
      </p>
    </AuthCard>
  )
}
