import { createAlertSender, loadAlertConfig } from '../_shared/alertSender.ts'
import { createRpc, createTurnstileVerifier } from '../_shared/clients.ts'
import { createSubmitPublicHandler } from './handler.ts'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY')

// null (any email secret missing or malformed) = alerts are off: no alert is ever claimed, so
// nothing is lost, and the next customer edit can still send it once the secrets are fixed.
const alertConfig = loadAlertConfig((name) => Deno.env.get(name))

Deno.serve(
  createSubmitPublicHandler({
    rpc: createRpc(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    verifyTurnstile: turnstileSecret ? createTurnstileVerifier(turnstileSecret) : null,
    ipHashSecret: Deno.env.get('IP_HASH_SECRET') ?? null,
    sendAlert: alertConfig ? createAlertSender(alertConfig) : null,
  }),
)
