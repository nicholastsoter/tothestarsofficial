// Cloudflare Turnstile (the bot check). The script is fetched only when a customer first needs
// a token, never on page load. The widget runs invisibly unless Cloudflare wants more proof.

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  execute(id: string): void
  reset(id: string): void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

let scriptPromise: Promise<TurnstileApi> | null = null
function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')))
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('turnstile failed to load'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

let widgetId: string | null = null
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

/** Resolves with a fresh single-use token. Each call asks for a new one. */
export async function getTurnstileToken(container: HTMLElement, timeoutMs = 20_000): Promise<string> {
  if (!turnstileSiteKey) throw new Error('turnstile not configured')
  const api = await loadScript()

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null
      reject(new Error('turnstile timed out'))
    }, timeoutMs)
    pending = {
      resolve: (t) => (clearTimeout(timer), resolve(t)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    }

    if (widgetId === null) {
      widgetId = api.render(container, {
        sitekey: turnstileSiteKey,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (t: string) => pending?.resolve(t),
        'error-callback': () => pending?.reject(new Error('turnstile error')),
        'timeout-callback': () => pending?.reject(new Error('turnstile timeout')),
      })
    } else {
      api.reset(widgetId)
    }
    api.execute(widgetId)
  })
}
