// Everything the public review page needs from the server, using plain fetch so this route
// doesn't pull in the Supabase client. Reads go through the get_public_review_page function;
// writes go through the submit-public Edge Function.
import type { AnswerValue, PublicQuestion } from './survey'

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const publicConfigured = Boolean(BASE && KEY)

export interface PublicPage {
  slug: string
  name: string
  logo_url: string | null
  brand_color: string
  thank_you_message: string
  place_id: string | null
  questions: PublicQuestion[]
}

/** null = no such business. Throws on network or server errors. */
export async function fetchPublicPage(slug: string, signal?: AbortSignal): Promise<PublicPage | null> {
  const res = await fetch(`${BASE}/rest/v1/rpc/get_public_review_page`, {
    method: 'POST',
    headers: { apikey: KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_slug: slug }),
    signal,
  })
  if (!res.ok) throw new Error(`page request failed: ${res.status}`)
  return (await res.json()) as PublicPage | null
}

async function post(body: Record<string, unknown>, keepalive = false): Promise<Response> {
  return fetch(`${BASE}/functions/v1/submit-public`, {
    method: 'POST',
    headers: { apikey: KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  })
}

/** Fire-and-forget analytics. Never blocks or breaks the page, and never needs a captcha. */
export function sendEvent(slug: string, action: 'page_view' | 'star_click' | 'google_link_click', star?: number): void {
  post({ action, slug, ...(star ? { star } : {}) }, true).catch(() => {})
}

export interface FeedbackPayload {
  slug: string
  visitToken: string
  star: number
  message: string
  answers: { question_id: string; answer: AnswerValue }[]
  contact: { name: string; email: string; consent: boolean }
  turnstileToken: string
  honeypot: string
}

export async function sendFeedback(p: FeedbackPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await post({
      action: 'submit_feedback',
      slug: p.slug,
      visit_token: p.visitToken,
      star: p.star,
      message: p.message,
      answers: p.answers,
      contact: p.contact.consent ? p.contact : undefined,
      turnstile_token: p.turnstileToken,
      website: p.honeypot,
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    return data.ok ? { ok: true } : { ok: false, error: data.error ?? `status_${res.status}` }
  } catch {
    return { ok: false, error: 'network' }
  }
}

/** A random per-visit id. Held in memory only; the server stores just a hash of it. */
export function newVisitToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}
