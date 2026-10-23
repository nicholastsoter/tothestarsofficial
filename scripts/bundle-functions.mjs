// Bundles each Edge Function (handler + shared helpers) into one dependency-free file under
// dist-functions/<name>/index.ts, ready to paste or deploy. The functions use only web
// standards, so there is nothing to install on the Deno side.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

for (const name of ['submit-public', 'places-search', 'delete-account', 'send-test-alert']) {
  mkdirSync(`dist-functions/${name}`, { recursive: true })
  await build({
    entryPoints: [`supabase/functions/${name}/index.ts`],
    outfile: `dist-functions/${name}/index.ts`,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    legalComments: 'none',
  })
  console.log('bundled', name)
}
