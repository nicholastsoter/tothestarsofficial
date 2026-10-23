# Phase 1 manual test steps

Setup first (see README). Then:

1. **Signed-out redirect:** open `/dashboard` while logged out. You land on `/login`.
2. **Signup:** `/signup`, enter email and an 8+ character password. You land on "Check your email".
   Try a 5-character password: the form blocks it.
3. **Email verification:** open the email, click the link. You land on `/dashboard`, logged in.
   Check the user in Supabase, Authentication, Users: `timezone` appears in user metadata.
4. **Unverified login:** sign up with a second email, do NOT click the link, try to log in.
   You see "Please verify your email first" with a resend link.
5. **Login / logout:** log out from the side menu, then log in. Wrong password shows
   "Incorrect email or password."
6. **Password reset:** "Forgot password?", enter your email, click the emailed link, set a new
   password, then log in with it. Open `/reset-password` directly (no link): "Link expired or invalid".
7. **Mobile:** shrink the window below 768px; the sidebar becomes a Menu button.
8. **Public page:** `/r/anything` loads while logged out (placeholder until Phase 2).
9. **Database security (optional, in the Supabase SQL editor):** `select * from feedback;` as the
   anon role should fail with "permission denied".

---

# Phase 2 manual test steps

Setup first: migrations applied, the three Edge Function secrets set, functions deployed, `.env`
filled in (README). Use the Turnstile test key pair for local testing.

## A. Onboarding
1. Log in with a new (verified) account. Dashboard shows "0 of 4" with step 1 open.
2. Enter a business name and Continue. The checklist moves to step 2 (1 of 4).
   In Supabase, Table editor, `businesses`: `timezone` matches yours (not UTC unless you are).
3. Step 2: type your business name and city. Results appear after a short pause ("Powered by
   Google"). Pick one, confirm the name/address, "Use this listing". Step 2 is ticked.
   Search for gibberish: you see "No matches".
4. Step 3: upload a PNG/JPG/WebP. Try a PDF (refused) and a very large photo (accepted, resized).
   Storage, `logos`: the file is inside a folder named after your business id.
5. Step 4: open QR & Link and click any download. Back on the Dashboard: 4 of 4.

## B. Settings
1. Change brand colour and thank-you message, Save. Reload: values stick.
2. Try slug `admin`, `ab`, `Has Caps`: each is refused with a reason.
3. Change the slug to something valid. A yellow note says the old link keeps working. Save.
   Open `/r/<old slug>`: it redirects to the new one.
4. Remove the logo, upload another. Only one file remains in the folder.

## C. QR page
1. The QR preview and link show `/r/<slug>` (NOT a google.com link). Copy button works.
2. Download PNG, SVG and PDF. Scan the PNG with your phone: it opens your review page.
   The PDF is one US Letter page with the business name, logo, QR, "Scan to leave a review".

## D. Public page (use your phone or a private window; no login)
1. Open `/r/<slug>`. Tap **2 stars**: the "Review us on Google" button appears immediately, above
   everything, followed by the optional survey, a second Google link, then the thank-you message.
   Answer a question, Send. In Supabase `feedback`: ONE row (star 2, your answers, question text saved).
2. Tap **5 stars** on the same visit: survey is replaced by the text box and the SAME row now says
   5 stars with the answers cleared. Type a message, Send: still one row.
3. Reload and tap a star again: a second row (new visit). Rows with no text/answers don't show
   in the inbox (built in Phase 3) but do count in analytics.
4. Click "Review us on Google": opens google.com/local/writereview?placeid=... in a new tab. `events`
   has a `google_link_click` row.
5. Visit `/r/not-a-real-page`: friendly "couldn't find that page".
6. `events` also has `page_view` and `star_click` rows.

## E. Two-account isolation (required before launch)
1. Create accounts A and B, each with a business and some feedback (use two browsers).
2. As A, open the browser console and run:
   `await (await fetch('<SUPABASE_URL>/rest/v1/feedback?select=*', {headers:{apikey:'<ANON_KEY>', Authorization:'Bearer <A access token>'}})).json()`
   You see only A's rows. Repeat for `businesses`, `survey_questions`, `events`.
3. As A, try to PATCH one of B's feedback rows by id: 0 rows change. Try to set `star_rating` on
   your own row: refused ("permission denied").
4. Without a token (anon key only), the same GET returns "permission denied".
5. Upload a file to `logos/<B's business id>/x.png` as A: refused.

## F. Account deletion (use a throwaway account)
1. Settings, "Delete my account...". The red button stays disabled until you type your email.
2. Delete. You land on login with "Your account and data have been deleted."
3. Supabase: the auth user, business, feedback, events and the `logos/<business id>/` files are gone.
   Logging in with the old credentials fails.

## G. Abuse checks (optional)
- Hit the public page 31+ times quickly with feedback: after 30 the page stops saving (429) but
  the Google button still works.
- In the console: `fetch('<SUPABASE_URL>/functions/v1/submit-public',{method:'POST',body:JSON.stringify({action:'submit_feedback',slug:'<slug>',visit_token:'a'.repeat(32),star:5})})`
  returns `captcha_required`; with a made-up `turnstile_token` returns `captcha_failed`.

---

# Phase 3 manual test steps

Setup: migration `0007` applied; `submit-public` and `places-search` redeployed; an account with a
business (Phase 2). The alert email is NOT connected yet, so skip section D until a provider is wired in.

## A. Survey editor
1. Side nav, **Survey**. The two starter questions show, with a live preview on the right (a phone-style
   card: 2 stars, the Google button first, then your questions).
2. Move question 2 up, then reload: the order stuck. Preview matches.
3. **+ Add question**: click Add with nothing typed ("Write the question first"). Choose Multiple choice
   with one empty option (refused), two identical options (refused), then valid options (added).
4. Edit a question; delete one (a warning says past responses keep their wording).
5. Add questions until you have 10: the Add button disables ("10 of 10").
6. Untick **Survey is on**: the preview shows the "simple text box" note. On your public page, tap 2 stars:
   a plain text box replaces the questions. Tick it back on.
7. Open `/r/<slug>` in a private window, tap 2 stars, answer a question. In the dashboard, delete that
   question, then press Send in the private window: the page says the survey was updated, drops that
   answer, keeps the rest, and Send works again. Edits reach the public page immediately.

## B. Inbox
1. Submit feedback from the public page: a 2-star with a message, a 5-star with a message, a 3-star with
   survey answers, and a bare star tap. In **Inbox**: all but the bare tap appear.
   (Analytics will count the bare tap.)
2. The Inbox menu item shows the number of New items. Mark one resolved: the number drops. Reopen it.
3. Filter by status, star range and dates; search for a word from a message and for a survey answer;
   search `%` or `_` (they match only those literal characters). Try each sort.
4. Add a private note and Save. Reload: it's still there. It never appears on the public page.
5. A customer who ticked "OK to contact me" shows name/email on the card; others show none.
6. Delete an item: it asks for confirmation first.
7. With more than 20 items, use Previous / Next.
8. In Supabase (SQL editor, role anon), `select * from feedback` is denied; as owner A you never see B's items.
   Try to edit `star_rating` or `message` of your own item through the API: "permission denied".

## C. CSV export
1. **Export this view (CSV)** and **Export everything (CSV)**. Open in Excel/Sheets: dates are in your
   business time zone, each survey question is a column, contact columns are filled only for opt-ins.
2. Submit feedback whose message is `=HYPERLINK("http://example.com","click")`, export again: the cell shows
   the text with a leading `'` and does NOT become a link or formula.

## D. Low-rating alerts (Resend)

Setup first: the three email secrets are set (README, "Email alerts") and `submit-public` plus
`send-test-alert` are deployed. While you're still on the Resend test sender, Resend only delivers to
the email address of your own Resend account (as I understand it; confirm in Resend's docs), so
log in to the app with that same address for these tests.

**D1. Test button (no review needed)**
1. Settings, "Email me when someone leaves a low rating" box, click **Send test alert**.
2. Within a minute an email arrives at your login address. Subject starts with **[TEST]**; the body has a
   yellow "TEST EMAIL: nothing happened at your business" banner, a sample 2-star message and an
   "Open your inbox" button (which goes to your app's `/inbox`).
3. Click it 4 times quickly: the 4th says you've sent a few already (limit: 3 an hour).
4. Break a secret on purpose (e.g. set `RESEND_API_KEY` to junk): the button says it couldn't send, with no
   technical details. Set an empty/missing secret: it says email alerts aren't set up on the server. Fix it again.

**D2. Real alert flow**
1. On your public page (private window), tap 2 stars. Nothing is emailed yet (a bare star tap).
2. Type a message (or answer a survey question) and Send: one email arrives with the star rating, your
   message and answers, and an inbox link. The email never shows a customer name or email, even if you
   ticked "OK to contact me".
3. Edit the same feedback and send again: **no second email**.
4. A 4-5 star with a message: no email. Switch the Settings box off, submit a new 2-star with a message:
   no email. Switch it back on.
5. Put `<script>alert(1)</script>` in a message: the email shows it as plain text.
6. Submit 11+ low-rated items with messages within an hour: at most 10 emails; all are saved in the Inbox.

**D3. Failure safety**
1. Set `RESEND_API_KEY` to a wrong value, submit a 2-star with a message: the customer still sees success
   and the item is in your Inbox, no email goes out. Fix the key, edit that same feedback: the email now arrives.
2. In the Supabase dashboard, Edge Functions, `submit-public`, Logs: you see only short messages such as
   "alert email failed: Error". No keys, no provider response text.

## E. Legal pages and footer
1. `/privacy` and `/terms` show a yellow DRAFT banner and [BRACKETED] placeholders.
2. The public review page footer links to both.

## F. Google search limits
1. In Settings, search for your business 21 times in an hour: the 21st says you've searched a lot.
2. (Hard to trigger by hand) after 300 searches in a day across all accounts, search says it's busy, try tomorrow.
