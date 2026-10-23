/** The visitor's IANA time zone (e.g. "America/Chicago"), read from their browser. */
export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** A time zone Postgres is likely to accept: the candidate if the browser recognises it, else the browser's own. */
export function resolveTimeZone(candidate: unknown): string {
  if (typeof candidate === 'string' && candidate) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: candidate })
      return candidate
    } catch {
      /* fall through */
    }
  }
  return getBrowserTimeZone()
}
