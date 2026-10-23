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
