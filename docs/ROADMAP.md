# Roadmap and contracts

## Decisions locked in (from review of the Phase 0 proposal)

1. **One feedback row per visit.** Created at the first star tap (empty message, empty
   `survey_answers`); the same row is updated if the customer changes their rating or adds text.
   - Inbox shows only rows where `has_content` is true.
   - Analytics (average rating, star distribution, ratings collected) count every row.
   - `star_click` events remain, for funnel metrics only.
   - The browser never gets table access. `submit-public` returns the new row id plus a random
     edit token; only its hash is stored (`feedback_secrets`). Updates must present the token and
     are allowed for 24 hours after creation.
2. **Rate limits:** about 30 submissions per hour per IP per business (shared guest Wi-Fi).
   Turnstile is required only when creating or updating feedback; `page_view` and
   `google_link_click` events get the rate limit only. (Built in Phase 2; the counter function
   `rate_limit_hit` already exists and is tested.)
3. **Slugs:** `slug_history` keeps old slugs so old QR codes redirect. Reserved words are blocked
   in the database. A slug can be changed at most 10 times.
4. **Owners can edit only `status` and `private_note`** on feedback (column-level grants), proven
   by tests.
5. **Time zone** is detected from the browser at signup and stored in the user's metadata;
   onboarding copies it into `businesses.timezone`. The column has no default.

## Added to the plan

- **Account deletion** (build in Phase 2 with Settings, before any real customer):
  Edge Function `delete-account` that (a) re-checks the password, (b) deletes the
  `logos/<business_id>/` files from Storage, then (c) deletes the auth user. Everything else is
  removed by `on delete cascade` (already proven by a test). Plus a "download my data" CSV.
- **Privacy policy and Terms pages:** moved from Phase 5 to **before the first real customer**.
  I will draft them, but they need review by a lawyer. They must cover: optional customer
  contact details, the only Google data stored being the Place ID, event/IP-hash retention,
  and Resend/Supabase/Cloudflare as processors.

## Phase 2 assumptions I made (change any of them)

- **Rate limits:** 30 feedback writes/hour and 300 events/hour per visitor-IP-hash per business
  (separate counters, because one customer produces about 3 events). Owners: 100 Google
  searches/hour per account.
- **Turnstile timing:** it can't run before the first star tap, because that tap is what creates the
  feedback row. So it loads on the first tap (never on page load) and runs invisibly unless
  Cloudflare wants more proof. The Google link appears immediately and never waits for it.
- **Google link placement:** shown first after a rating, and again below the optional form
  (4-5 stars: below the text box; 1-3 stars: at the end of the survey).
- **Account deletion** asks the user to type their account email (checked on the server). Asking
  for the password again would be stronger, at the cost of an extra step.
- **Logos:** inputs up to 10 MB are accepted and resized to 512 px; the uploaded file is always
  under 2 MB. SVG is refused (SVG files can carry scripts).
- **Contact opt-in** (name/email with an explicit checkbox) is on the public form.
- Onboarding step 4 uses a new `businesses.qr_downloaded_at` column so it's marked done from data.

## Phase 3 assumptions I made (change any of them)

- **Alerts are built but not connected to an email provider.** The database decides whether an
  alert is due and claims it atomically (`claim_low_rating_alert`), so there is at most one email
  per feedback item; `submit-public` sends it; a failed send releases the claim so the next edit can
  retry. Until a provider is wired in, no claim is ever made and no email goes out. Limits: 1-3 stars,
  only once the item has a message or survey answers, only if the owner's toggle is on, at most
  10 per business per hour.
- **The alert email also lists survey answers** (with the question text), not only the message,
  because many low ratings carry answers and no message. It never includes contact details.
- **Dates in the inbox filter and the CSV use the business's time zone**, not UTC or the browser's.
- **Reordering uses up/down buttons**, not drag and drop (accessible and simpler). It is one atomic
  database call, so the unique position rule can't be broken.
- **Required questions** are only enforced once the customer starts answering (the survey stays optional).
- **Survey switched off** (or no questions): 1-3 star customers see a simple text box instead.
- **A survey edited mid-visit:** the server validates answers against the CURRENT questions. If a
  customer's answers no longer fit, the page reloads the questions, keeps what still fits, and asks
  them to send again. Old responses keep the wording they were answered with.
- **CSV export** has no row cap; it fetches 500 rows at a time and builds the file in batches so the
  page stays responsive. It lists each survey question as a column and includes contact details
  only where the customer opted in.
- **Privacy policy and terms are DRAFTS** with a banner and placeholders. They need legal review.

## Email provider decision (waiting on you)

See the options in the Phase 3 report. Wiring needs: the provider's API key as a Supabase secret,
a verified sender, `APP_BASE_URL`, and a small `send` function (the email content is already built
and tested in `supabase/functions/_shared/alertEmail.ts`).

## Launch checklist: do NOT onboard a real customer until all of these are true

- [ ] Privacy policy and Terms pages are live and linked from the public review page and signup
      (reviewed by a lawyer; they must cover optional contact details, the Place-ID-only rule,
      hashed IPs, and the processors: Supabase, Cloudflare, Resend, Google).
- [ ] Turnstile: real site + secret keys set (not the test pair), widget domains limited to your domains.
- [ ] Google Places key restricted to Places API (New) only, daily quota capped, billing budget
      alert created.
- [ ] `IP_HASH_SECRET`, `TURNSTILE_SECRET_KEY`, `GOOGLE_PLACES_API_KEY` set as Supabase secrets, and
      none of them (or the service-role key) appear anywhere in the browser bundle.
- [ ] Leaked-password protection and email confirmation are ON in Supabase Auth.
- [ ] Site URL and redirect URLs set to the production domain; `VITE_PUBLIC_BASE_URL` set so QR
      codes print the production address.
- [ ] Manual two-account isolation test passed (steps in `docs/manual-test-steps.md`).
- [ ] `cleanup_rate_limits()` scheduled daily.
- [ ] Email provider connected with a VERIFIED sending domain; alert emails tested end to end,
      including that no customer contact details appear in them.
- [ ] Privacy policy and terms: drafts replaced by the lawyer-reviewed versions, banner removed,
      all [BRACKETS] filled in.
- [ ] Account deletion tested end to end on the real project with a throwaway account.

## Phase 5 (not started)

Stripe billing with a free tier (`subscriptions` table written only by a Stripe webhook);
multi-location (drop `unique(owner_user_id)`, add a location switcher); team seats
(`business_members` table, change only `is_business_owner()`); admin panel (separate admin
role, audit log); schedule `cleanup_rate_limits()` daily.
