import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { readableTextColor } from '../../lib/color'
import { googleReviewLink } from '../../lib/links'
import { fetchPublicPage, newVisitToken, publicConfigured, sendEvent, sendFeedback, type PublicPage } from '../../lib/publicApi'
import { extraFor, firstMissingRequired, toAnswerPayload, type AnswerMap, type PublicQuestion } from '../../lib/survey'
import { getTurnstileToken, turnstileSiteKey } from '../../lib/turnstile'

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'error' } | { state: 'ready'; page: PublicPage }
type Contact = { consent: boolean; name: string; email: string }
const NO_CONTACT: Contact = { consent: false, name: '', email: '' }

export default function PublicReviewPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  // set before redirecting, so arriving at the new address doesn't fetch the same page again
  const loadedSlug = useRef<string | null>(null)

  useEffect(() => {
    if (!publicConfigured) return setLoad({ state: 'error' })
    if (loadedSlug.current === slug.toLowerCase()) return
    const ctrl = new AbortController()
    setLoad({ state: 'loading' })
    fetchPublicPage(slug, ctrl.signal)
      .then((page) => {
        if (!page) return setLoad({ state: 'missing' })
        loadedSlug.current = page.slug
        setLoad({ state: 'ready', page })
        // an old link (the owner renamed their page): move to the current address
        if (page.slug !== slug.toLowerCase()) navigate(`/r/${page.slug}`, { replace: true })
      })
      .catch((e) => e?.name !== 'AbortError' && setLoad({ state: 'error' }))
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  if (load.state === 'loading') return <Shell><p className="py-24 text-center text-sm text-slate-500" role="status">Loading…</p></Shell>
  if (load.state === 'missing') {
    return (
      <Shell>
        <div className="py-20 text-center">
          <p className="text-4xl" aria-hidden>🔍</p>
          <h1 className="mt-3 text-lg font-semibold">We couldn't find that page</h1>
          <p className="mt-1 text-sm text-slate-600">The link may be mistyped or out of date. Please check the QR code or link you were given.</p>
        </div>
      </Shell>
    )
  }
  if (load.state === 'error') {
    return (
      <Shell>
        <div className="py-20 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-1 text-sm text-slate-600">Please check your connection and try again.</p>
          <button className="mt-4 rounded-lg px-4 py-2 text-sm ring-1 ring-slate-300" onClick={() => location.reload()}>Try again</button>
        </div>
      </Shell>
    )
  }
  return <ReviewFlow page={load.page} />
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-slate-50 px-4 py-6">
      <div className="w-full max-w-md">{children}</div>
    </main>
  )
}

function ReviewFlow({ page }: { page: PublicPage }) {
  const color = page.brand_color
  const onColor = readableTextColor(color)
  const googleLink = googleReviewLink(page.place_id)

  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [contact, setContact] = useState<Contact>(NO_CONTACT)
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [formError, setFormError] = useState<string | null>(null)

  // The save queue always sends the *latest* state, so it reads from a ref.
  const latest = useRef({ rating, message, answers, contact })
  latest.current = { rating, message, answers, contact }
  const visitToken = useRef(newVisitToken())
  const turnstileBox = useRef<HTMLDivElement>(null)
  const honeypot = useRef<HTMLInputElement>(null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const queued = useRef(false)
  const viewed = useRef<string | null>(null)

  useEffect(() => {
    if (viewed.current === page.slug) return
    viewed.current = page.slug
    sendEvent(page.slug, 'page_view')
  }, [page.slug])

  async function saveNow(): Promise<boolean> {
    const s = latest.current
    if (!s.rating || !turnstileBox.current) return false
    try {
      const turnstileToken = await getTurnstileToken(turnstileBox.current)
      const res = await sendFeedback({
        slug: page.slug,
        visitToken: visitToken.current,
        star: s.rating,
        message: s.message,
        answers: toAnswerPayload(page.questions, s.answers),
        contact: s.contact,
        turnstileToken,
        honeypot: honeypot.current?.value ?? '',
      })
      return res.ok
    } catch {
      return false
    }
  }

  /** Saves one at a time; taps that arrive while one is waiting collapse into a single save. */
  function save(): Promise<boolean> {
    if (queued.current) return chain.current as Promise<boolean>
    queued.current = true
    const next = chain.current.then(() => {
      queued.current = false
      return saveNow()
    })
    chain.current = next
    return next
  }

  function onRate(n: number) {
    const switchedGroup = rating !== null && extraFor(rating) !== extraFor(n)
    if (switchedGroup) {
      // don't quietly keep text typed for the other kind of form
      setMessage('')
      setAnswers({})
      setContact(NO_CONTACT)
      setStatus('idle')
      latest.current = { rating: n, message: '', answers: {}, contact: NO_CONTACT }
    } else {
      latest.current = { ...latest.current, rating: n }
    }
    setRating(n)
    sendEvent(page.slug, 'star_click', n)
    void save() // runs in the background; the Google link below never waits for it
  }

  async function onSubmitExtras(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (rating !== null && extraFor(rating) === 'survey') {
      const missing = firstMissingRequired(page.questions, answers)
      if (missing) return setFormError('Please answer the questions marked with *, or clear the form to skip it.')
    }
    setStatus('sending')
    const ok = await save()
    setStatus(ok ? 'sent' : 'error')
  }

  const kind = rating ? extraFor(rating) : null

  return (
    <Shell>
      <header className="flex flex-col items-center gap-3 py-6 text-center">
        {page.logo_url ? (
          <img src={page.logo_url} alt={`${page.name} logo`} className="max-h-20 max-w-[200px] object-contain" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold" style={{ background: color, color: onColor }} aria-hidden>
            {page.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <h1 className="text-xl font-semibold">{page.name}</h1>
      </header>

      <section className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200">
        <h2 className="text-base font-medium">How was your experience?</h2>
        <StarPicker value={rating} color={color} onChange={onRate} />
      </section>

      {rating !== null && (
        <div className="mt-4 space-y-4">
          {googleLink && (
            <section className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-700">Share your experience with others on Google. It only takes a minute.</p>
              <a
                href={googleLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => sendEvent(page.slug, 'google_link_click', rating)}
                className="mt-3 inline-block w-full rounded-lg px-4 py-3 text-sm font-semibold shadow-sm"
                style={{ background: color, color: onColor }}
              >
                Review us on Google
              </a>
            </section>
          )}

          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <form onSubmit={onSubmitExtras} className="space-y-4" noValidate>
              <p className="text-sm font-medium">
                {kind === 'survey' ? 'Help us improve (optional)' : 'Anything else you’d like to tell us? (optional)'}
              </p>

              {kind === 'text' && (
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder="Your feedback goes straight to the owner."
                  aria-label="Your feedback"
                  className="block w-full rounded-lg border-0 p-3 text-sm ring-1 ring-slate-300 focus:ring-2 focus:outline-none"
                />
              )}
              {kind === 'survey' && (page.questions.length > 0 ? (
                <div className="space-y-4">
                  {page.questions.map((q) => (
                    <QuestionField key={q.id} q={q} value={answers[q.id]} color={color} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                  ))}
                </div>
              ) : (
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder="What could we have done better?"
                  aria-label="Your feedback"
                  className="block w-full rounded-lg border-0 p-3 text-sm ring-1 ring-slate-300 focus:ring-2 focus:outline-none"
                />
              ))}

              <ContactOptIn value={contact} onChange={setContact} />

              {/* honeypot: invisible to people, tempting to bots */}
              <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />

              {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
              {status === 'sent' && <p role="status" className="text-sm text-green-700">Thank you! Your feedback was sent.</p>}
              {status === 'error' && (
                <p role="alert" className="text-sm text-red-700">We couldn't send your feedback just now. Please try again in a moment.</p>
              )}

              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Send again' : 'Send feedback'}
              </button>
            </form>
          </section>

          {googleLink && (
            <p className="text-center text-sm">
              <a
                href={googleLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => sendEvent(page.slug, 'google_link_click', rating)}
                className="font-medium underline underline-offset-2"
              >
                Leave a Google review
              </a>
            </p>
          )}

          <section className="rounded-2xl p-5 text-center text-sm" style={{ background: `${color}1a` }}>
            {page.thank_you_message}
          </section>
        </div>
      )}

      {/* Turnstile mounts here, and only appears if Cloudflare needs the customer to do something */}
      <div ref={turnstileBox} className="mt-4 flex justify-center" />
      {!turnstileSiteKey && import.meta.env.DEV && <p className="mt-4 text-center text-xs text-amber-700">Dev note: VITE_TURNSTILE_SITE_KEY is not set, so feedback can't be saved.</p>}
    </Shell>
  )
}

function Star({ filled, color }: { filled: boolean; color: string }) {
  return <span aria-hidden className="text-5xl leading-none transition-colors" style={{ color: filled ? color : '#cbd5e1' }}>★</span>
}

function StarPicker({ value, color, onChange }: { value: number | null; color: string; onChange: (n: number) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0
  return (
    <div role="radiogroup" aria-label="Star rating" className="mt-3 flex justify-center gap-1" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(null)}
          className="rounded-md p-1 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Star filled={n <= shown} color={color} />
        </button>
      ))}
    </div>
  )
}

function QuestionField({ q, value, color, onChange }: { q: PublicQuestion; value: string | number | undefined; color: string; onChange: (v: string | number | undefined) => void }) {
  const label = (
    <span className="mb-1 block text-sm font-medium">
      {q.prompt}
      {q.required && <span aria-hidden> *</span>}
    </span>
  )
  const box = 'block w-full rounded-lg border-0 p-3 text-sm ring-1 ring-slate-300 focus:ring-2 focus:outline-none'

  if (q.type === 'short_text') {
    return (
      <label className="block">
        {label}
        <input type="text" maxLength={300} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={box} required={q.required} />
      </label>
    )
  }
  if (q.type === 'long_text') {
    return (
      <label className="block">
        {label}
        <textarea rows={3} maxLength={2000} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={box} />
      </label>
    )
  }
  if (q.type === 'multiple_choice') {
    return (
      <fieldset>
        <legend>{label}</legend>
        <div className="space-y-1.5">
          {(q.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 has-[:checked]:bg-slate-50 has-[:checked]:ring-slate-400">
              <input type="radio" name={q.id} checked={value === o} onChange={() => onChange(o)} />
              {o}
            </label>
          ))}
        </div>
      </fieldset>
    )
  }
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="flex gap-1" role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 5`} onClick={() => onChange(value === n ? undefined : n)} className="rounded p-0.5">
            <span aria-hidden className="text-3xl leading-none" style={{ color: typeof value === 'number' && n <= value ? color : '#cbd5e1' }}>★</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function ContactOptIn({ value, onChange }: { value: Contact; onChange: (c: Contact) => void }) {
  const field = 'block w-full rounded-lg border-0 p-2.5 text-sm ring-1 ring-slate-300 focus:ring-2 focus:outline-none'
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={value.consent} onChange={(e) => onChange({ ...value, consent: e.target.checked })} />
        <span>It's OK for the business to contact me about my feedback.</span>
      </label>
      {value.consent && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input type="text" autoComplete="name" maxLength={120} placeholder="Your name" aria-label="Your name" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} className={field} />
          <input type="email" autoComplete="email" maxLength={254} placeholder="Your email" aria-label="Your email" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} className={field} />
        </div>
      )}
    </div>
  )
}
