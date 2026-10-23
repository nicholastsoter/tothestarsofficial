// delete-account: permanently deletes the caller's account and all their data.
// Order matters: logo files first (the database can't remove files from Storage), then the
// auth user, whose deletion cascades to the business, survey, feedback and events.
// If the first step fails nothing else is touched, and the whole thing is safe to retry.

import { bearerToken, isRecord, json, preflight, readJsonBody } from '../_shared/http.ts'

export interface DeleteAccountDeps {
  getUser: (token: string) => Promise<{ id: string; email: string | null } | null>
  findBusinessId: (userId: string) => Promise<string | null>
  deleteLogos: (businessId: string) => Promise<void>
  deleteAuthUser: (userId: string) => Promise<void>
}

export function createDeleteAccountHandler(deps: DeleteAccountDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const token = bearerToken(req)
    if (!token) return json(401, { error: 'unauthorized' })

    const parsed = await readJsonBody(req, 1_000)
    if (!parsed.ok) return parsed.response
    if (!isRecord(parsed.body) || typeof parsed.body.confirm !== 'string') return json(400, { error: 'invalid_request' })

    let user: { id: string; email: string | null } | null
    try {
      user = await deps.getUser(token)
    } catch {
      return json(500, { error: 'server_error' })
    }
    if (!user) return json(401, { error: 'unauthorized' })

    // the user must type their own account email; checked here, not just in the browser
    if (!user.email || parsed.body.confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
      return json(400, { error: 'confirmation_mismatch' })
    }

    try {
      const businessId = await deps.findBusinessId(user.id)
      if (businessId) await deps.deleteLogos(businessId)
    } catch (err) {
      console.error('delete-account: storage cleanup failed:', err instanceof Error ? err.message : 'unknown')
      return json(500, { error: 'storage_cleanup_failed' })
    }

    try {
      await deps.deleteAuthUser(user.id)
    } catch (err) {
      console.error('delete-account: user deletion failed:', err instanceof Error ? err.message : 'unknown')
      return json(500, { error: 'user_delete_failed' })
    }

    return json(200, { ok: true })
  }
}
