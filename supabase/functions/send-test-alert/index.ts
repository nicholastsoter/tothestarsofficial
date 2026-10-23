import { loadAlertConfig } from '../_shared/alertSender.ts'
import { createFindBusinessName, createGetUser, createRpc } from '../_shared/clients.ts'
import { createSendTestAlertHandler } from './handler.ts'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const email = loadAlertConfig((name) => Deno.env.get(name))

Deno.serve(
  createSendTestAlertHandler({
    getUser: createGetUser(url, Deno.env.get('SUPABASE_ANON_KEY')!),
    findBusinessName: createFindBusinessName(url, serviceKey),
    rpc: createRpc(url, serviceKey),
    email,
  }),
)
