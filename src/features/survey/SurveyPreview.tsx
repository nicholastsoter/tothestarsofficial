import { useState } from 'react'
import { readableTextColor } from '../../lib/color'
import type { AnswerMap, PublicQuestion } from '../../lib/survey'
import { QuestionField } from '../public-review/QuestionField'
import type { Question } from './useSurvey'

/** What a customer who taps 1-3 stars sees. Same field component as the public page; nothing is saved. */
export default function SurveyPreview({ questions, enabled, color, businessName }: { questions: Question[]; enabled: boolean; color: string; businessName: string }) {
  const [answers, setAnswers] = useState<AnswerMap>({})
  const asPublic: PublicQuestion[] = questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options, required: q.required }))

  return (
    <div className="rounded-3xl bg-slate-100 p-3 ring-1 ring-slate-200" aria-label="Preview of the customer survey">
      <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-slate-500">Preview (1-3 star customers)</p>
      <div className="mx-auto max-w-sm space-y-3">
        <h3 className="text-center text-base font-semibold">{businessName}</h3>
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-medium">How was your experience?</p>
          <p className="mt-1 text-4xl leading-none" aria-hidden style={{ color }}>★★<span style={{ color: '#cbd5e1' }}>★★★</span></p>
        </div>
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200">
          <span className="inline-block w-full rounded-lg px-4 py-2.5 text-sm font-semibold" style={{ background: color, color: readableTextColor(color) }}>Review us on Google</span>
          <p className="mt-2 text-xs text-slate-500">Always shown first, whatever the rating.</p>
        </div>
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-medium">Help us improve (optional)</p>
          {!enabled ? (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">The survey is switched off, so customers see a simple text box instead.</p>
          ) : asPublic.length === 0 ? (
            <p className="text-xs text-slate-500">No questions yet. Customers will see a simple text box.</p>
          ) : (
            asPublic.map((q) => <QuestionField key={q.id} q={q} value={answers[q.id]} color={color} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />)
          )}
          <span className="block rounded-lg bg-slate-900 px-4 py-2 text-center text-sm font-semibold text-white opacity-60">Send feedback</span>
        </div>
      </div>
    </div>
  )
}
