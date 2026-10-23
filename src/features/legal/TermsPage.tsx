import LegalLayout from './LegalLayout'

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="October 2026">
      <p>
        These terms govern your use of To The Stars Ratings, operated by [LEGAL ENTITY NAME] (“we”, “us”). By creating an account you
        agree to them.
      </p>

      <h2>The service</h2>
      <p>
        We provide tools to collect customer feedback through a public review page and QR code, and to send customers to a business’s Google
        review page. We do not guarantee any particular number of reviews or any rating.
      </p>

      <h2>Your account</h2>
      <p>You must provide accurate information, keep your password secure, and be responsible for activity on your account. One account may manage one business.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>The Google review link is shown to every customer regardless of their rating. You must not change, hide or filter it, or otherwise discourage unhappy customers from reviewing you.</li>
        <li>Do not offer incentives in exchange for reviews where that is prohibited by Google’s policies or the law.</li>
        <li>Do not submit fake feedback, attempt to overload or bypass the service’s protections, or access other businesses’ data.</li>
        <li>You are responsible for complying with the laws that apply to you, including rules about contacting customers.</li>
      </ul>

      <h2>Customer data</h2>
      <p>
        You control the feedback collected for your business and are responsible for how you use it, including any contact details customers
        choose to share. See our Privacy Policy.
      </p>

      <h2>Third-party services</h2>
      <p>The service relies on Google, Cloudflare, Supabase and others. Their availability and terms are outside our control.</p>

      <h2>Fees</h2>
      <p>[PRICING AND BILLING TERMS, IF ANY]</p>

      <h2>Termination</h2>
      <p>You can delete your account at any time in Settings. We may suspend accounts that break these terms.</p>

      <h2>Disclaimers and liability</h2>
      <p>[WARRANTY DISCLAIMER AND LIMITATION OF LIABILITY. TO BE COMPLETED BY COUNSEL.]</p>

      <h2>Governing law</h2>
      <p>[JURISDICTION AND DISPUTE RESOLUTION]</p>

      <h2>Changes and contact</h2>
      <p>We may update these terms and will note the date above. Questions: [CONTACT EMAIL].</p>
    </LegalLayout>
  )
}
