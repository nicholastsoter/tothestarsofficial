import { useState } from 'react'
import { MAX_OPTIONS, validateQuestionDraft, type QuestionDraft, type QuestionType } from '../../lib/survey'

export const TYPE_LABELS: Record<QuestionType, string> = {
  short_text: 'Short answer',
  long_text: 'Long answer',
  multiple_choice: 'Multiple choice',
  rating: '1-5 rating',
}

const field = 'block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-600 focus:outline-none'

export default function QuestionForm({
  initial, submitLabel, onSubmit, onCancel,
}: {
  initial?: QuestionDraft
  submitLabel: string
  onSubmit: (draft: QuestionDraft) => Promise<string | null>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<QuestionDraft>(initial ?? { type: 'short_text', prompt: '', options: ['', ''], required: false })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setOption = (i: number, v: string) => setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? v : o)) }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateQuestionDraft(draft)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const err = await onSubmit(draft)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200" noValidate>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Question</span>
        <input className={field} value={draft.prompt} maxLength={300} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} placeholder="What could we have done better?" autoFocus />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Answer type</span>
          <select className={field} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as QuestionType })}>
            {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />
          Required (once a customer starts answering)
        </label>
      </div>

      {draft.type === 'multiple_choice' && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Answer options (2 to {MAX_OPTIONS})</legend>
          {draft.options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input className={field} value={o} maxLength={100} aria-label={`Option ${i + 1}`} onChange={(e) => setOption(i, e.target.value)} />
              <button type="button" aria-label={`Remove option ${i + 1}`} disabled={draft.options.length <= 2} onClick={() => setDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))} className="rounded-lg px-3 text-slate-500 ring-1 ring-slate-300 hover:bg-white disabled:opacity-30">✕</button>
            </div>
          ))}
          <button type="button" disabled={draft.options.length >= MAX_OPTIONS} onClick={() => setDraft((d) => ({ ...d, options: [...d.options, ''] }))} className="text-sm font-medium text-indigo-600 hover:underline disabled:opacity-40">+ Add option</button>
        </fieldset>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg bg-white px-4 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-50">Cancel</button>
      </div>
    </form>
  )
}
