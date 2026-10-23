import { useState } from 'react'
import { Card, Notice } from '../../components/ui/ui'
import { useBusiness } from '../../contexts/BusinessContext'
import { MAX_QUESTIONS, type QuestionDraft } from '../../lib/survey'
import QuestionForm, { TYPE_LABELS } from './QuestionForm'
import SurveyPreview from './SurveyPreview'
import { useSurvey, type Question } from './useSurvey'

const toDraft = (q: Question): QuestionDraft => ({ type: q.type, prompt: q.prompt, options: q.options ?? ['', ''], required: q.required })

export default function SurveyEditor() {
  const { business } = useBusiness()
  const s = useSurvey(business?.id)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  if (s.loading) return <p className="text-sm text-slate-500" role="status">Loading…</p>
  if (s.error || !s.survey || !business) return <Notice tone="error">{s.error ?? 'No survey found.'}</Notice>
  const survey = s.survey

  const run = async (p: Promise<string | null>) => {
    const err = await p
    setMessage(err)
    return err
  }
  const full = s.questions.length >= MAX_QUESTIONS

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Card>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={survey.enabled} onChange={(e) => void run(s.setEnabled(e.target.checked))} />
            <span>
              <strong>Survey is on</strong>
              <span className="block text-slate-600">Customers who give 1-3 stars see these questions. If it’s off, they see a simple text box. Changes go live on your review page immediately.</span>
            </span>
          </label>
        </Card>

        {message && <Notice tone="error">{message}</Notice>}

        <ol className="space-y-3">
          {s.questions.map((q, i) => (
            <li key={q.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              {editing === q.id ? (
                <QuestionForm initial={toDraft(q)} submitLabel="Save question" onCancel={() => setEditing(null)} onSubmit={async (d) => {
                  const err = await s.update(q.id, d)
                  if (!err) setEditing(null)
                  return err
                }} />
              ) : (
                <div className="flex items-start gap-3">
                  <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{q.prompt}{q.required && <span className="text-red-700" aria-label="required"> *</span>}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{TYPE_LABELS[q.type]}{q.options ? `: ${q.options.join(' · ')}` : ''}</p>
                    {confirmDelete === q.id && (
                      <div className="mt-2 rounded-lg bg-red-50 p-3 text-sm ring-1 ring-red-200">
                        <p className="text-red-900">Delete this question? Past responses keep the wording they were answered with.</p>
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={async () => { await run(s.remove(q.id)); setConfirmDelete(null) }} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white">Yes, delete</button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg bg-white px-3 py-1.5 ring-1 ring-slate-300">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1 text-sm">
                    <button type="button" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => void run(s.move(q.id, -1))} className="rounded px-2 py-1 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-30">↑</button>
                    <button type="button" aria-label={`Move question ${i + 1} down`} disabled={i === s.questions.length - 1} onClick={() => void run(s.move(q.id, 1))} className="rounded px-2 py-1 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-30">↓</button>
                    <button type="button" onClick={() => { setEditing(q.id); setConfirmDelete(null) }} className="rounded px-2 py-1 text-indigo-700 hover:bg-indigo-50">Edit</button>
                    <button type="button" onClick={() => setConfirmDelete(q.id)} className="rounded px-2 py-1 text-red-700 hover:bg-red-50">Delete</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>

        {s.questions.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-600 ring-1 ring-slate-200">No questions yet.</p>}

        {editing === 'new' ? (
          <QuestionForm submitLabel="Add question" onCancel={() => setEditing(null)} onSubmit={async (d) => {
            const err = await s.add(d)
            if (!err) setEditing(null)
            return err
          }} />
        ) : (
          <div className="flex items-center gap-3">
            <button type="button" disabled={full} onClick={() => { setEditing('new'); setMessage(null) }} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">+ Add question</button>
            <span className="text-xs text-slate-500">{s.questions.length} of {MAX_QUESTIONS} questions{full ? ' (the maximum)' : ''}</span>
          </div>
        )}
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <SurveyPreview questions={s.questions} enabled={survey.enabled} color={business.brand_color} businessName={business.name} />
      </div>
    </div>
  )
}
