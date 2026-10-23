# To The Stars Ratings

Multi-tenant app that collects customer feedback and sends happy customers to Google Reviews.
React + Vite + TypeScript, Tailwind, Supabase. No AI features.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at http://localhost:5173 |
| `npm test` | Database security tests, Edge Function tests, helper tests (no Docker or Supabase needed) |
| `npm run typecheck` | Check TypeScript |
| `npm run build` | Typecheck and build for production |
| `npm run bundle:functions` | Bundle each Edge Function into one file under `dist-functions/` |

## Setup

### 1. Supabase
1. Create a project. Apply `supabase/migrations/*.sql` in order (SQL editor, or `supabase db push`).
2. Authentication, URL Configuration: Site URL `http://localhost:5173`; Redirect URLs
   `http://localhost:5173/dashboard` and `http://localhost:5173/reset-password`.
3. Authentication, Email: keep "Confirm email" ON.
4. Deploy the three Edge Functions from `supabase/functions/` (`supabase functions deploy`, or
   paste the bundles from `npm run bundle:functions`). `submit-public` must have JWT verification
   **off** (`supabase/config.toml` already says so); the other two keep it on.

### 2. Edge Function secrets (never put these in `.env` or the browser)
Dashboard, Edge Functions, Secrets (or `supabase secrets set NAME=value`):

| Secret | What it is | How to get it |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Lets `places-search` call Google | see "Google Places key" below |
| `TURNSTILE_SECRET_KEY` | Lets `submit-public` check bot-test tokens | Cloudflare, see below |
| `IP_HASH_SECRET` | Scrambles visitor IPs before they are counted | run `openssl rand -hex 32` and paste the result |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions
automatically. Until the three secrets above are set, the functions refuse to work (by design).

### 3. Turnstile (bot check on the public page)
1. Cloudflare dashboard, Turnstile, Add widget. Add your domain(s) plus `localhost` for testing.
   Mode: Managed.
2. Put the **site key** in `.env` as `VITE_TURNSTILE_SITE_KEY` (public) and the **secret key** in
   the `TURNSTILE_SECRET_KEY` Supabase secret.
3. For local testing you can use Cloudflare's published test pair: site key
   `1x00000000000000000000AA` (always passes) with secret `1x0000000000000000000000000000000AA`.
   Never ship those.

### 4. Google Places key (owner's business search)
Menu names change over time; the idea is what matters.
1. Google Cloud Console: create a project, attach a billing account, enable **Places API (New)**.
2. APIs & Services, Credentials, Create credentials, API key.
3. **Restrict the key to Places API only:** edit the key, "API restrictions", "Restrict key",
   tick only **Places API (New)**. If the key leaks it can then do nothing else.
4. Application restrictions: leave "None". Supabase Edge Functions don't have a fixed outgoing IP,
   so an IP restriction would block your own calls. The key is protected instead by living only in
   Supabase secrets, the API restriction above, the per-account rate limit (100 searches/hour), and
   the quota cap below.
5. **Cap daily usage:** APIs & Services, Places API (New), Quotas: lower the requests-per-day limits
   for Autocomplete to a number you're comfortable paying for if something goes wrong.
6. **Billing alert:** Billing, Budgets & alerts, Create budget for that project, e.g. a small
   monthly amount with email alerts at 50%, 90% and 100%. Alerts only warn; the quota cap is
   what actually stops spending.
7. Check Google's current Places pricing before launch. Autocomplete requests are billed.

### 5. The app
`cp .env.example .env`, fill in the Supabase URL, publishable key and Turnstile **site** key, then
`npm install && npm run dev`.

See `docs/manual-test-steps.md` and `docs/ROADMAP.md`.
