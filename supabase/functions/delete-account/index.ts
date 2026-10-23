import { createDeleteAuthUser, createDeleteLogos, createFindBusinessId, createGetUser } from '../_shared/clients.ts'
import { createDeleteAccountHandler } from './handler.ts'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(
  createDeleteAccountHandler({
    getUser: createGetUser(url, Deno.env.get('SUPABASE_ANON_KEY')!),
    findBusinessId: createFindBusinessId(url, serviceKey),
    deleteLogos: createDeleteLogos(url, serviceKey),
    deleteAuthUser: createDeleteAuthUser(url, serviceKey),
  }),
)
