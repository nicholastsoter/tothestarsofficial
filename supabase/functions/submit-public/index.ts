import { createRpc, createTurnstileVerifier } from '../_shared/clients.ts'
import { createSubmitPublicHandler } from './handler.ts'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY')

Deno.serve(
  createSubmitPublicHandler({
    rpc: createRpc(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    verifyTurnstile: turnstileSecret ? createTurnstileVerifier(turnstileSecret) : null,
    ipHashSecret: Deno.env.get('IP_HASH_SECRET') ?? null,
  }),
)
