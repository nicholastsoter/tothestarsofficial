import type { PublicQuestion } from '../../lib/survey'

export function QuestionField({ q, value, color, onChange }: { q: PublicQuestion; value: string | number | undefined; color: string; onChange: (v: string | number | undefined) => void }) {
  const label = (
    <span className="mb-1 block text-sm font-medium">
      {q.prompt}
      {q.required && <span aria-hidden> *</span>}
    </span>
  )
  const box = 'block w-full rounded-lg border-0 p-3 text-sm ring-1 ring-slate-300 focus:ring-2 focus:outline-none'

  if (q.type === 'short_text') {
    return (
      <label className="block">
        {label}
        <input type="text" maxLength={300} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={box} required={q.required} />
      </label>
    )
  }
  if (q.type === 'long_text') {
    return (
      <label className="block">
        {label}
        <textarea rows={3} maxLength={2000} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={box} />
      </label>
    )
  }
  if (q.type === 'multiple_choice') {
    return (
      <fieldset>
        <legend>{label}</legend>
        <div className="space-y-1.5">
          {(q.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 has-[:checked]:bg-slate-50 has-[:checked]:ring-slate-400">
              <input type="radio" name={q.id} checked={value === o} onChange={() => onChange(o)} />
              {o}
            </label>
          ))}
        </div>
      </fieldset>
    )
  }
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="flex gap-1" role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 5`} onClick={() => onChange(value === n ? undefined : n)} className="rounded p-0.5">
            <span aria-hidden className="text-3xl leading-none" style={{ color: typeof value === 'number' && n <= value ? color : '#cbd5e1' }}>★</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}
