// send-test-alert: the Settings "Send test alert" button. Sends ONE clearly labelled test email to
// the logged-in owner's OWN address (taken from their verified login, never from the request),
// so they can check delivery without waiting for a real low rating. Rate limited per account.

import { buildTestAlertEmail, type AlertEmail } from '../_shared/alertEmail.ts'
import type { Rpc } from '../_shared/clients.ts'
import { bearerToken, json, preflight } from '../_shared/http.ts'

export interface SendTestAlertDeps {
  getUser: (token: string) => Promise<{ id: string; email: string | null } | null>
  findBusinessName: (userId: string) => Promise<string | null>
  rpc: Rpc
  /** null when the email secrets aren't (all) set */
  email: { send: (email: AlertEmail) => Promise<void>; inboxUrl: string } | null
  perHour?: number
}

export function createSendTestAlertHandler(deps: SendTestAlertDeps) {
  const perHour = deps.perHour ?? 3

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const token = bearerToken(req)
    if (!token) return json(401, { error: 'unauthorized' })

    try {
      const user = await deps.getUser(token)
      if (!user) return json(401, { error: 'unauthorized' })
      if (!user.email) return json(400, { error: 'no_email' })

      // checked before the rate limit so a missing setup never uses up the owner's few tries
      if (!deps.email) return json(503, { error: 'not_configured' })

      const allowed = await deps.rpc('rate_limit_hit', { p_key: `testalert:${user.id}`, p_limit: perHour, p_window_seconds: 3600 })
      if (allowed !== true) return json(429, { error: 'rate_limited' }, { 'Retry-After': '3600' })

      const name = (await deps.findBusinessName(user.id)) ?? 'your business'
      await deps.email.send(buildTestAlertEmail(user.email, name, deps.email.inboxUrl))
      return json(200, { ok: true, sent_to: user.email })
    } catch (err) {
      // only the error's class is logged: no message text that could echo provider details
      console.error('send-test-alert failed:', err instanceof Error ? err.name : 'unknown error')
      return json(502, { error: 'send_failed' })
    }
  }
}
