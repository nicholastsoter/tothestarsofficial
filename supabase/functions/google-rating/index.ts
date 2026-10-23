import { createFindOwnBusiness, createGetUser, createRpc } from '../_shared/clients.ts'
import { createGoogleRatingHandler } from './handler.ts'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(
  createGoogleRatingHandler({
    getUser: createGetUser(url, Deno.env.get('SUPABASE_ANON_KEY')!),
    findOwnBusiness: createFindOwnBusiness(url, serviceKey),
    rpc: createRpc(url, serviceKey),
    googleApiKey: Deno.env.get('GOOGLE_PLACES_API_KEY') ?? null,
  }),
)
