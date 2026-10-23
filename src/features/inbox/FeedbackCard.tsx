import { useState } from 'react'
import { formatTimestamp } from '../../lib/csv'
import { deleteItem, setNote, setStatus, type InboxRow } from './api'

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)
const answerText = (v: unknown) => (typeof v === 'number' ? `${v} out of 5` : typeof v === 'string' ? v : '')

export default function FeedbackCard({
  row, timeZone, onChanged, onDeleted,
}: {
  row: InboxRow
  timeZone: string
  onChanged: (patch: Partial<InboxRow>) => void
  onDeleted: () => void
}) {
  const [note, setNoteText] = useState(row.private_note ?? '')
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = note.trim() !== (row.private_note ?? '')
  const resolved = row.status === 'resolved'

  async function toggle() {
    setBusy(true)
    setError(null)
    const next = resolved ? 'new' : 'resolved'
    if (await setStatus(row.id, next)) onChanged({ status: next })
    else setError('Could not update the status. Please try again.')
    setBusy(false)
  }

  async function saveNote() {
    setNoteState('saving')
    const ok = await setNote(row.id, note)
    setNoteState(ok ? 'saved' : 'error')
    if (ok) onChanged({ private_note: note.trim() === '' ? null : note.trim() })
  }

  async function remove() {
    setBusy(true)
    setError(null)
    if (await deleteItem(row.id)) onDeleted()
    else {
      setError('Could not delete this item. Please try again.')
      setBusy(false)
    }
  }

  const answers = row.survey_answers.filter((a) => typeof a.prompt === 'string')

  return (
    <li className={`rounded-2xl bg-white p-4 shadow-sm ring-1 sm:p-5 ${resolved ? 'ring-slate-200' : 'ring-indigo-200'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-lg leading-none text-amber-400" role="img" aria-label={`${row.star_rating} out of 5 stars`}>{stars(row.star_rating)}</span>
        <time className="text-xs text-slate-500" dateTime={row.created_at}>{formatTimestamp(row.created_at, timeZone)}</time>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${resolved ? 'bg-green-100 text-green-800' : 'bg-indigo-100 text-indigo-800'}`}>
          {resolved ? 'Resolved' : 'New'}
        </span>
      </div>

      {row.message && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{row.message}</p>}

      {answers.length > 0 && (
        <dl className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          {answers.map((a, i) => (
            <div key={i}>
              <dt className="text-xs font-medium text-slate-500">{String(a.prompt)}</dt>
              <dd className="whitespace-pre-wrap text-slate-800">{answerText(a.answer)}</dd>
            </div>
          ))}
        </dl>
      )}

      {(row.contact_name || row.contact_email) && (
        <p className="mt-3 text-sm text-slate-700">
          <span className="text-xs font-medium text-slate-500">Customer agreed to be contacted: </span>
          {row.contact_name}
          {row.contact_name && row.contact_email ? ' · ' : ''}
          {row.contact_email && <a className="text-indigo-600 underline" href={`mailto:${encodeURIComponent(row.contact_email)}`}>{row.contact_email}</a>}
        </p>
      )}

      <div className="mt-4">
        <label className="text-xs font-medium text-slate-500" htmlFor={`note-${row.id}`}>Private note (only you can see this)</label>
        <textarea
          id={`note-${row.id}`}
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => { setNoteText(e.target.value); setNoteState('idle') }}
          className="mt-1 block w-full rounded-lg border-0 p-2.5 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-600 focus:outline-none"
        />
        <div className="mt-1 flex items-center gap-3">
          <button type="button" onClick={saveNote} disabled={!dirty || noteState === 'saving'} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            {noteState === 'saving' ? 'Saving…' : 'Save note'}
          </button>
          {noteState === 'saved' && !dirty && <span role="status" className="text-xs text-green-700">Saved</span>}
          {noteState === 'error' && <span role="alert" className="text-xs text-red-700">Couldn’t save the note</span>}
        </div>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={toggle} disabled={busy} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50">
          {resolved ? 'Reopen' : 'Mark resolved'}
        </button>
        <span className="flex-1" />
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="text-sm text-red-700 hover:underline">Delete</button>
        ) : (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Delete this feedback permanently?</span>
            <button type="button" onClick={remove} disabled={busy} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Yes, delete'}</button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="text-slate-600 hover:underline">Cancel</button>
          </span>
        )}
      </div>
    </li>
  )
}
