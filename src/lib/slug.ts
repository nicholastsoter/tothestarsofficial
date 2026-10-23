/** Mirrors public.is_reserved_slug() in the database, which is the real enforcement. This copy
 *  only gives instant feedback while typing. Keep the two lists in sync. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'auth', 'login', 'logout', 'signup', 'register', 'r', 'settings', 'dashboard',
  'onboarding', 'survey', 'inbox', 'analytics', 'qr', 'account', 'billing', 'pricing', 'privacy', 'terms',
  'help', 'support', 'about', 'contact', 'www', 'static', 'assets', 'public', 'verify-email', 'forgot-password',
  'reset-password', 'new', 'null', 'undefined', 'root', 'system', 'tothestars', 'to-the-stars',
])

const FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Returns a human-readable problem with the slug, or null if it looks fine. */
export function validateSlug(slug: string): string | null {
  if (slug.length < 3) return 'Use at least 3 characters.'
  if (slug.length > 50) return 'Use at most 50 characters.'
  if (!FORMAT.test(slug)) return 'Use only lowercase letters, numbers and single hyphens (no hyphen at the start or end).'
  if (RESERVED_SLUGS.has(slug)) return 'That name is reserved. Please choose another.'
  return null
}

/** "Joe's Pizza & Pasta!" -> "joes-pizza-pasta" */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

/** A valid slug derived from a business name. `suffix` makes it unique when the plain one is taken. */
export function suggestSlug(name: string, suffix = ''): string {
  let base = slugify(name)
  if (base.length < 3) base = `${base}${base ? '-' : ''}reviews`.slice(0, 40)
  if (RESERVED_SLUGS.has(base)) base = `${base}-reviews`
  return suffix ? `${base}-${suffix}` : base
}

export function randomSuffix(length = 4): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}
