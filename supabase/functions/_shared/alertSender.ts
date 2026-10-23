// Turns the three secrets the owner sets (RESEND_API_KEY, ALERT_FROM_EMAIL, APP_BASE_URL) into a
// working email sender, or null if anything is missing or malformed. Null means "alerts are off":
// the callers then never claim an alert, so nothing is lost and a later edit can still send it.
import { buildAlertEmail, type AlertClaim, type AlertEmail } from './alertEmail.ts'
import type { FetchLike } from './clients.ts'
import { createResendSend, type SendEmail } from './resend.ts'

export interface AlertConfig {
  send: SendEmail
  inboxUrl: string
}

// "alerts@example.com" or "To The Stars <alerts@example.com>"; no line breaks, no stray characters
const FROM = /^(?:[^<>"\r\n]{1,80}\s<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+)$/

export function loadAlertConfig(get: (name: string) => string | undefined, f?: FetchLike): AlertConfig | null {
  const key = get('RESEND_API_KEY')?.trim()
  const from = get('ALERT_FROM_EMAIL')?.trim()
  const base = get('APP_BASE_URL')?.trim()
  if (!key || /\s/.test(key) || !from || !FROM.test(from) || !base) return null

  let inboxUrl: string
  try {
    const url = new URL(base)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    inboxUrl = new URL('/inbox', url.origin).toString()
  } catch {
    return null
  }
  return { send: createResendSend(key, from, f), inboxUrl }
}

/** The function submit-public calls with a claimed alert. Throws on any failure so the claim is released. */
export function createAlertSender(config: AlertConfig) {
  return (claim: AlertClaim): Promise<void> => config.send(buildAlertEmail(claim, config.inboxUrl))
}

export type { AlertEmail }
