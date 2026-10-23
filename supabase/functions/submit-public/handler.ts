// submit-public: the only way the public review page writes anything. Deployed with JWT
// verification OFF because visitors are not logged in; protection comes from the honeypot,
// per-visitor rate limits, and Turnstile (required whenever feedback is created or changed).

import type { Rpc } from '../_shared/clients.ts'
import { clientIp, hmacHex, isRecord, json, preflight, readJsonBody, sha256Hex } from '../_shared/http.ts'

export interface SubmitPublicDeps {
  rpc: Rpc
  /** null when the Turnstile secret isn't configured; feedback writes then fail closed. */
  verifyTurnstile: ((token: string) => Promise<boolean>) | null
  /** secret used to hash visitor IPs; null makes every request fail closed. */
  ipHashSecret: string | null
  feedbackPerHour?: number
  eventsPerHour?: number
}

const MAX_BODY_BYTES = 20_000
const SLUG = /^[a-zA-Z0-9-]{1,60}$/
const VISIT_TOKEN = /^[A-Za-z0-9_-]{22,64}$/
const EVENT_ACTIONS = ['page_view', 'star_click', 'google_link_click'] as const
type EventAction = (typeof EVENT_ACTIONS)[number]

const isStar = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5
const isOptionalString = (v: unknown, max: number) => v === undefined || v === null || (typeof v === 'string' && v.length <= max)

type Fail = { error: string; status: number }

interface FeedbackInput {
  star: number
  message: string | null
  answers: { question_id: string; answer: string | number }[]
  contact: { name: string | null; email: string | null; consent: boolean }
  visitToken: string
  turnstileToken: string | null
}

function parseFeedback(body: Record<string, unknown>): FeedbackInput | Fail {
  if (typeof body.visit_token !== 'string' || !VISIT_TOKEN.test(body.visit_token)) return { error: 'invalid_token', status: 400 }
  if (!isStar(body.star)) return { error: 'invalid_star', status: 400 }
  if (!isOptionalString(body.message, 2000)) return { error: 'invalid_message', status: 400 }

  const answers: FeedbackInput['answers'] = []
  if (body.answers !== undefined && body.answers !== null) {
    if (!Array.isArray(body.answers) || body.answers.length > 20) return { error: 'invalid_answers', status: 400 }
    for (const a of body.answers) {
      const ok =
        isRecord(a) &&
        typeof a.question_id === 'string' &&
        a.question_id.length <= 40 &&
        ((typeof a.answer === 'string' && a.answer.length <= 2000) || (typeof a.answer === 'number' && Number.isFinite(a.answer)))
      if (!ok) return { error: 'invalid_answers', status: 400 }
      answers.push({ question_id: a.question_id as string, answer: a.answer as string | number })
    }
  }

  const c = body.contact
  if (c !== undefined && c !== null && !isRecord(c)) return { error: 'invalid_contact', status: 400 }
  const contact = isRecord(c) ? c : {}
  if (!isOptionalString(contact.name, 120) || !isOptionalString(contact.email, 254)) return { error: 'invalid_contact', status: 400 }
  if (contact.consent !== undefined && typeof contact.consent !== 'boolean') return { error: 'invalid_contact', status: 400 }

  const t = body.turnstile_token
  if (t !== undefined && t !== null && (typeof t !== 'string' || t.length > 2048)) return { error: 'captcha_failed', status: 403 }

  return {
    star: body.star,
    message: (body.message as string | null | undefined) ?? null,
    answers,
    contact: {
      name: (contact.name as string | null | undefined) ?? null,
      email: (contact.email as string | null | undefined) ?? null,
      consent: contact.consent === true,
    },
    visitToken: body.visit_token,
    turnstileToken: typeof t === 'string' && t !== '' ? t : null,
  }
}

const isFail = (v: object): v is Fail => 'status' in v

export function createSubmitPublicHandler(deps: SubmitPublicDeps) {
  const feedbackLimit = deps.feedbackPerHour ?? 30
  const eventLimit = deps.eventsPerHour ?? 300

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const parsed = await readJsonBody(req, MAX_BODY_BYTES)
    if (!parsed.ok) return parsed.response
    const body = parsed.body
    if (!isRecord(body)) return json(400, { error: 'invalid_request' })

    // Honeypot: a hidden field real people never fill in. Pretend it worked, store nothing.
    if (body.website !== undefined && body.website !== null && body.website !== '' && body.website !== false) {
      return json(200, { ok: true })
    }

    const action = body.action
    const isEvent = (EVENT_ACTIONS as readonly unknown[]).includes(action)
    if (!isEvent && action !== 'submit_feedback') return json(400, { error: 'invalid_action' })
    if (typeof body.slug !== 'string' || !SLUG.test(body.slug)) return json(400, { error: 'invalid_slug' })
    const slug = body.slug.toLowerCase()

    // validate the payload before spending any database or network work on it
    let feedback: FeedbackInput | null = null
    let eventStar: number | null = null
    if (isEvent) {
      const star = body.star ?? null
      if (star !== null && !isStar(star)) return json(400, { error: 'invalid_star' })
      if (action === 'star_click' && star === null) return json(400, { error: 'invalid_star' })
      if (action === 'page_view' && star !== null) return json(400, { error: 'invalid_star' })
      eventStar = star as number | null
    } else {
      const f = parseFeedback(body)
      if (isFail(f)) return json(f.status, { error: f.error })
      feedback = f
    }

    // fail closed if the server isn't fully configured
    if (!deps.ipHashSecret) return json(500, { error: 'server_misconfigured' })
    if (feedback && !deps.verifyTurnstile) return json(500, { error: 'server_misconfigured' })

    try {
      const ipHash = await hmacHex(deps.ipHashSecret, clientIp(req) ?? 'unknown')

      const gate = (await deps.rpc('public_gate', {
        p_slug: slug,
        p_bucket: feedback ? 'fb' : 'ev',
        p_ip_hash: ipHash,
        p_limit: feedback ? feedbackLimit : eventLimit,
      })) as { found: boolean; allowed: boolean }
      if (!gate.found) return json(404, { error: 'not_found' })
      if (!gate.allowed) return json(429, { error: 'rate_limited' }, { 'Retry-After': '3600' })

      if (!feedback) {
        await deps.rpc('public_track_event', { p_slug: slug, p_type: action as EventAction, p_star: eventStar })
        return json(200, { ok: true })
      }

      // feedback writes need a Turnstile token that Cloudflare confirms is genuine
      if (!feedback.turnstileToken) return json(403, { error: 'captcha_required' })
      if (!(await deps.verifyTurnstile!(feedback.turnstileToken))) return json(403, { error: 'captcha_failed' })

      const result = (await deps.rpc('public_submit_feedback', {
        p_slug: slug,
        p_token_hash: await sha256Hex(feedback.visitToken),
        p_star: feedback.star,
        p_message: feedback.message,
        p_answers: feedback.answers,
        p_contact_name: feedback.contact.name,
        p_contact_email: feedback.contact.email,
        p_contact_consent: feedback.contact.consent,
      })) as { ok: boolean; error?: string }

      // only ever answer with ok/error: no row ids, no stored values
      if (result.ok) return json(200, { ok: true })
      const status = result.error === 'not_found' ? 404 : result.error === 'expired' ? 409 : result.error === 'invalid_token' ? 403 : 400
      return json(status, { error: result.error === 'expired' ? 'visit_expired' : result.error })
    } catch (err) {
      console.error('submit-public failed:', err instanceof Error ? err.message : 'unknown error')
      return json(500, { error: 'server_error' })
    }
  }
}
