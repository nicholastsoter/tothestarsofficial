// The one place that talks to Resend. Plain fetch, so it's easy to fake in tests.
// Errors carry ONLY the HTTP status: provider response bodies can contain details
// about the account or key and must never reach logs, customers or the browser.
import type { AlertEmail } from './alertEmail.ts'
import type { FetchLike } from './clients.ts'

export type SendEmail = (email: AlertEmail) => Promise<void>

export function createResendSend(apiKey: string, from: string, f: FetchLike = fetch): SendEmail {
  return async (email) => {
    const res = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) throw new Error(`email provider responded with status ${res.status}`)
  }
}
