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

## What's in the app (Phases 1-3)

Sign-up and verification, onboarding checklist, Google listing lookup, settings, QR/print sign,
public review page, **survey editor with live preview, feedback inbox (filters, search, notes,
CSV export), response view, and low-rating email alerts (built, provider not connected yet)**.
Draft privacy and terms pages live at `/privacy` and `/terms`.

**Phase 4: Analytics.** Date-range picker, KPI cards with previous-period comparison, charts, a
funnel, goal progress and before/after tracking, all computed in the database (security-invoker
functions, so each owner only ever sees their own numbers). The live Google rating panel is
designed but waits on a decision (see `docs/ROADMAP.md`).

## Demo data for the Analytics charts

A script creates a clearly-labelled FAKE business (its own fake login, separate from your real
business) with ~120 days of believable activity. It only runs against the project you name.
In your own terminal (never paste these values into chat):

```bash
export SUPABASE_URL="https://<your-project-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<Supabase dashboard, Project Settings, API, service_role>"
node scripts/seed-test-data.mjs --project-ref <your-project-ref>            # dry run, writes nothing
node scripts/seed-test-data.mjs --project-ref <your-project-ref> --apply    # creates it, prints the fake login once
node scripts/seed-test-data.mjs --project-ref <your-project-ref> --delete   # removes it all again
```

It refuses to run unless `SUPABASE_URL` is exactly `https://<ref>.supabase.co` for the ref you pass.

## Setup

### 1. Supabase
1. Create a project. Apply `supabase/migrations/*.sql` in order (0001 to 0008) (SQL editor, or `supabase db push`).
2. Authentication, URL Configuration: Site URL `http://localhost:5173`; Redirect URLs
   `http://localhost:5173/dashboard` and `http://localhost:5173/reset-password`.
3. Authentication, Email: keep "Confirm email" ON.
4. Deploy the four Edge Functions (`submit-public`, `places-search`, `delete-account`, `send-test-alert`) from `supabase/functions/` (`supabase functions deploy`, or
   paste the bundles from `npm run bundle:functions`). `submit-public` must have JWT verification
   **off** (`supabase/config.toml` already says so); the other two keep it on.

### 2. Edge Function secrets (never put these in `.env` or the browser)
Dashboard, Edge Functions, Secrets (or `supabase secrets set NAME=value`):

| Secret | What it is | How to get it |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Lets `places-search` call Google | see "Google Places key" below |
| `TURNSTILE_SECRET_KEY` | Lets `submit-public` check bot-test tokens | Cloudflare, see below |
| `IP_HASH_SECRET` | Scrambles visitor IPs before they are counted | run `openssl rand -hex 32` and paste the result |

### Email alerts (Resend)
Three more secrets turn on the low-rating alert emails and the Settings "Send test alert" button. If any
is missing or malformed, alerts simply stay off (nothing is lost; the next customer edit retries).

| Secret | What it is | Where the value comes from |
|---|---|---|
| `RESEND_API_KEY` | Lets the functions send through Resend | Resend dashboard, **API Keys**, Create API Key, permission "Sending access". Copy it when it is shown (it appears once). |
| `ALERT_FROM_EMAIL` | The "From" address on alerts | Start with the Resend test sender `onboarding@resend.dev`. After you verify your domain, change it to e.g. `To The Stars <alerts@yourdomain.com>`. **No code change needed**, only this secret. |
| `APP_BASE_URL` | Where the email's "Open your inbox" button points | Your production app address with no path, e.g. `https://tothestars-rust.vercel.app` (later your own domain). |

Set them yourself, in your own terminal (never paste real values into chat):

```bash
supabase secrets set RESEND_API_KEY=<paste-your-resend-key> --project-ref mtpthbkjhnajllmsawez
supabase secrets set ALERT_FROM_EMAIL="onboarding@resend.dev" --project-ref mtpthbkjhnajllmsawez
supabase secrets set APP_BASE_URL="https://tothestars-rust.vercel.app" --project-ref mtpthbkjhnajllmsawez
```

(No CLI installed? Use the Supabase dashboard instead: Edge Functions, Secrets, add each name and value.
`brew install supabase/tap/supabase` then `supabase login` installs the CLI.) New values apply to new
function runs; if a function seems to use an old value, redeploy it. To switch to your own sender later,
run only the `ALERT_FROM_EMAIL` line with the new address.

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
