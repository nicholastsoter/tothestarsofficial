// Small web-standard helpers shared by the Edge Functions. No dependencies, so the same
// code runs on Supabase (Deno) and in the Vitest tests (Node).

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

export function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Reads a JSON body, refusing anything bigger than maxBytes before parsing it. */
export async function readJsonBody(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > maxBytes) return { ok: false, response: json(413, { error: 'too_large' }) }

  const text = await req.text()
  if (text.length > maxBytes) return { ok: false, response: json(413, { error: 'too_large' }) }

  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, response: json(400, { error: 'invalid_json' }) }
  }
}

/**
 * Best-effort visitor IP. Cloudflare sets cf-connecting-ip itself and a visitor cannot forge
 * it, so it wins; the others are fallbacks. The IP is only ever hashed, never stored.
 */
export function clientIp(req: Request): string | null {
  const direct = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip')
  if (direct) return direct.trim()
  const forwarded = req.headers.get('x-forwarded-for')
  return forwarded ? forwarded.split(',')[0].trim() : null
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(message: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)))
}

/** Keyed hash: without the secret, a stored hash can't be reversed by trying every IP address. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

export function bearerToken(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  return m ? m[1] : null
}
