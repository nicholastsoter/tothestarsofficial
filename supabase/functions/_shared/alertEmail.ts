// Builds the low-rating alert email. Pure functions, no provider code, so it's fully testable.
// Every customer-written value is HTML-escaped; the email never contains contact details.

export interface AlertClaim {
  feedback_id: string
  to_email: string
  business_name: string
  star_rating: number
  message: string | null
  answers: { prompt: string; answer: unknown }[]
  created_at: string
}

export interface AlertEmail {
  to: string
  subject: string
  html: string
  text: string
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }
export const escapeHtml = (s: string) => s.replace(/[&<>"'`]/g, (c) => ESCAPES[c])

/** Collapses to one line (no newlines can sneak into a subject) and caps the length. */
const oneLine = (s: string, max = 80) => s.replace(/[\r\n\u2028\u2029\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

const answerText = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? `${v} out of 5` : '')

export function buildAlertEmail(claim: AlertClaim, inboxUrl: string): AlertEmail {
  const url = new URL(inboxUrl) // throws on garbage
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('inbox link must be http(s)')

  const stars = Math.min(5, Math.max(1, Math.round(claim.star_rating)))
  const star = `${stars} ${stars === 1 ? 'star' : 'stars'}`
  const business = oneLine(claim.business_name || 'your business')
  const message = (claim.message ?? '').trim()
  const answers = claim.answers.map((a) => ({ prompt: oneLine(String(a.prompt ?? ''), 300), answer: answerText(a.answer) })).filter((a) => a.answer !== '')

  const subject = `New ${star} feedback for ${business}`

  const text = [
    `${business} received ${star} feedback.`,
    message ? `\nMessage:\n${message}` : '',
    answers.length ? `\nSurvey answers:\n${answers.map((a) => `- ${a.prompt}: ${a.answer}`).join('\n')}` : '',
    `\nOpen your inbox: ${url.toString()}`,
    '\nYou get this email because low-rating alerts are switched on in your Settings.',
  ].join('\n')

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;max-width:560px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 4px">${escapeHtml(business)}</h2>
<p style="margin:0 0 16px;color:#475569">New feedback: <strong>${escapeHtml(star)}</strong></p>
${message ? `<p style="margin:0 0 4px;font-weight:600">Message</p><p style="margin:0 0 16px;white-space:pre-wrap;background:#f1f5f9;padding:12px;border-radius:8px">${escapeHtml(message)}</p>` : ''}
${
  answers.length
    ? `<p style="margin:0 0 4px;font-weight:600">Survey answers</p><ul style="margin:0 0 16px;padding-left:18px">${answers
        .map((a) => `<li><em>${escapeHtml(a.prompt)}</em> ${escapeHtml(a.answer)}</li>`)
        .join('')}</ul>`
    : ''
}
<p style="margin:0 0 16px"><a href="${escapeHtml(url.toString())}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open your inbox</a></p>
<p style="margin:0;color:#64748b;font-size:12px">You get this email because low-rating alerts are switched on in your Settings.</p>
</body></html>`

  return { to: claim.to_email, subject, html, text }
}

/** Wires the builder to whichever email provider is chosen: `send` is the provider's call. */
export function createAlertSender(send: (email: AlertEmail) => Promise<void>, inboxUrl: string) {
  return (claim: AlertClaim) => send(buildAlertEmail(claim, inboxUrl))
}
