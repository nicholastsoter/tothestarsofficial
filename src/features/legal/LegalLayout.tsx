import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Shared frame for the legal pages. They are DRAFTS: the banner stays until a lawyer has reviewed them. */
export default function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/login" className="text-sm font-semibold text-slate-700">
        <span aria-hidden className="text-amber-400">★ </span>To The Stars
      </Link>
      <div role="note" className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-300">
        <strong>DRAFT. Not legal advice and not yet reviewed by a lawyer.</strong> Text in [square brackets] must be filled in. Do not
        rely on this document, and do not onboard real customers until it has been reviewed and this banner is removed.
      </div>
      <h1 className="mt-6 text-2xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">Draft last updated {updated}</p>
      <div className="mt-6 space-y-5 text-sm leading-6 text-slate-700 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
      <p className="mt-10 text-sm text-slate-500">
        <Link to="/privacy" className="underline">Privacy</Link> · <Link to="/terms" className="underline">Terms</Link>
      </p>
    </main>
  )
}
