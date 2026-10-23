import LegalLayout from './LegalLayout'

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="October 2026">
      <p>
        To The Stars Ratings (“we”, “us”) helps local businesses collect customer feedback. This policy explains what we collect, why, and
        who else handles it. The operator is [LEGAL ENTITY NAME], [ADDRESS]. Contact: [PRIVACY EMAIL].
      </p>

      <h2>If you are a business owner</h2>
      <ul>
        <li>Account data: your email address and password (stored hashed by our authentication provider), your time zone.</li>
        <li>Business details you enter: name, address, logo, brand colour, messages, survey questions.</li>
        <li>Your Google listing’s Place ID. This is the only piece of Google data we store. We do not store Google ratings, review counts or review text.</li>
        <li>Feedback your customers send you, your private notes and status on it, and basic usage counts (page views, star taps, survey completions, Google link clicks).</li>
      </ul>

      <h2>If you are a customer leaving feedback</h2>
      <ul>
        <li>Your star rating, and anything you choose to type or answer. Both are optional.</li>
        <li>Your name and email only if you tick the box allowing the business to contact you. If you don’t tick it, we don’t collect them.</li>
        <li>Counts of visits and clicks, which are not linked to you.</li>
        <li>
          Your IP address is used briefly to limit abuse. We store only a keyed, one-way hash of it (never the address itself), and a hash
          of a random per-visit code so only your visit can edit your feedback.
        </li>
      </ul>
      <p>The business you rate receives your feedback. We do not sell personal data or use it for advertising.</p>

      <h2>Google reviews</h2>
      <p>
        Everyone who rates a business is offered a link to leave a Google review, whatever their rating. Reviews are posted on Google, under
        Google’s terms and privacy policy, not ours.
      </p>

      <h2>Who handles data for us</h2>
      <ul>
        <li>Supabase: database, sign-in, file storage and server functions. [REGION]</li>
        <li>Cloudflare Turnstile: a bot check shown when feedback is submitted.</li>
        <li>Google Places API: searches by business owners to find their listing.</li>
        <li>Vercel: website hosting.</li>
        <li>[EMAIL PROVIDER]: sends alert emails to business owners about low ratings (not yet enabled).</li>
      </ul>

      <h2>Cookies</h2>
      <p>We use only what is needed to keep owners signed in. We do not use advertising or tracking cookies. [CONFIRM AFTER LEGAL REVIEW]</p>

      <h2>How long we keep data, and deleting it</h2>
      <p>
        Business owners can delete their account and all its data at any time in Settings. This permanently removes the business, logo,
        survey, feedback and usage counts. Customers who want feedback they submitted removed should contact the business or [PRIVACY EMAIL].
        [RETENTION PERIODS FOR BACKUPS AND LOGS]
      </p>

      <h2>Your rights</h2>
      <p>[RIGHTS OF ACCESS, CORRECTION, DELETION AND OBJECTION, BY JURISDICTION. TO BE COMPLETED BY COUNSEL.]</p>

      <h2>Children</h2>
      <p>The service is not directed at children under [AGE].</p>

      <h2>Changes</h2>
      <p>We will update this page when our practices change and note the date at the top.</p>
    </LegalLayout>
  )
}
