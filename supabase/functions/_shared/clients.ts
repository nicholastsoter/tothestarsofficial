// Thin wrappers around the HTTP APIs the functions call. Plain fetch only (no SDKs), and the
// fetch implementation is injectable so tests can fake the network.

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>
export type FetchLike = typeof fetch

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const serviceHeaders = (key: string) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
})

/** Calls a Postgres function through the REST API using the service-role key. */
export function createRpc(baseUrl: string, serviceKey: string, f: FetchLike = fetch): Rpc {
  return async (fn, args) => {
    const res = await f(`${baseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: serviceHeaders(serviceKey),
      body: JSON.stringify(args),
    })
    if (!res.ok) throw new Error(`rpc ${fn} failed with status ${res.status}`)
    return res.status === 204 ? null : await res.json()
  }
}

/** Asks Cloudflare whether a Turnstile token is genuine. Any failure counts as "not valid". */
export function createTurnstileVerifier(secret: string, f: FetchLike = fetch) {
  return async (token: string): Promise<boolean> => {
    try {
      const res = await f('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token }),
      })
      if (!res.ok) return false
      const data = (await res.json()) as { success?: boolean }
      return data.success === true
    } catch {
      return false
    }
  }
}

/** Turns a logged-in user's access token into the user it belongs to (null if invalid). */
export function createGetUser(baseUrl: string, anonKey: string, f: FetchLike = fetch) {
  return async (token: string): Promise<{ id: string; email: string | null } | null> => {
    const res = await f(`${baseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    const u = (await res.json()) as { id?: string; email?: string | null }
    return u.id && UUID.test(u.id) ? { id: u.id, email: u.email ?? null } : null
  }
}

export function createFindBusinessId(baseUrl: string, serviceKey: string, f: FetchLike = fetch) {
  return async (userId: string): Promise<string | null> => {
    if (!UUID.test(userId)) throw new Error('bad user id')
    const res = await f(`${baseUrl}/rest/v1/businesses?owner_user_id=eq.${userId}&select=id`, { headers: serviceHeaders(serviceKey) })
    if (!res.ok) throw new Error(`business lookup failed with status ${res.status}`)
    const rows = (await res.json()) as { id: string }[]
    return rows[0]?.id ?? null
  }
}

/** Deletes every file under logos/<businessId>/ through the Storage API (deleting database rows
 *  alone would leave the actual files behind). */
export function createDeleteLogos(baseUrl: string, serviceKey: string, f: FetchLike = fetch) {
  return async (businessId: string): Promise<void> => {
    if (!UUID.test(businessId)) throw new Error('bad business id')
    for (let round = 0; round < 10; round++) {
      const list = await f(`${baseUrl}/storage/v1/object/list/logos`, {
        method: 'POST',
        headers: serviceHeaders(serviceKey),
        body: JSON.stringify({ prefix: businessId, limit: 1000, offset: 0 }),
      })
      if (!list.ok) throw new Error(`storage list failed with status ${list.status}`)
      const items = (await list.json()) as { name: string }[]
      if (items.length === 0) return

      const del = await f(`${baseUrl}/storage/v1/object/logos`, {
        method: 'DELETE',
        headers: serviceHeaders(serviceKey),
        body: JSON.stringify({ prefixes: items.map((i) => `${businessId}/${i.name}`) }),
      })
      if (!del.ok) throw new Error(`storage delete failed with status ${del.status}`)
    }
    throw new Error('storage cleanup did not finish')
  }
}

/** Deleting the auth user cascades to the business and everything under it. */
export function createDeleteAuthUser(baseUrl: string, serviceKey: string, f: FetchLike = fetch) {
  return async (userId: string): Promise<void> => {
    if (!UUID.test(userId)) throw new Error('bad user id')
    const res = await f(`${baseUrl}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: serviceHeaders(serviceKey) })
    if (!res.ok) throw new Error(`auth delete failed with status ${res.status}`)
  }
}
