import { createGetUser, createRpc } from '../_shared/clients.ts'
import { createPlacesSearchHandler } from './handler.ts'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

const url = Deno.env.get('SUPABASE_URL')!

Deno.serve(
  createPlacesSearchHandler({
    getUser: createGetUser(url, Deno.env.get('SUPABASE_ANON_KEY')!),
    rpc: createRpc(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    googleApiKey: Deno.env.get('GOOGLE_PLACES_API_KEY') ?? null,
  }),
)
