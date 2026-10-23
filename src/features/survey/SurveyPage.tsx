import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useBusiness } from '../../contexts/BusinessContext'
import FeedbackList from '../inbox/FeedbackList'
import SurveyEditor from './SurveyEditor'

const tab = (active: boolean) => `rounded-lg px-4 py-2 text-sm font-medium ${active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`

export default function SurveyPage() {
  const { business, loading } = useBusiness()
  const [view, setView] = useState<'edit' | 'responses'>('edit')

  if (loading) return <p className="text-sm text-slate-500" role="status">Loading…</p>
  if (!business) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">Survey</h1>
        <p className="mt-2 text-slate-600">Create your business on the <Link to="/dashboard" className="font-medium text-indigo-600">Dashboard</Link> first.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-5">
      <h1 className="text-2xl font-semibold">Survey</h1>
      <div role="tablist" aria-label="Survey views" className="flex gap-1">
        <button role="tab" aria-selected={view === 'edit'} className={tab(view === 'edit')} onClick={() => setView('edit')}>Edit survey</button>
        <button role="tab" aria-selected={view === 'responses'} className={tab(view === 'responses')} onClick={() => setView('responses')}>Responses</button>
      </div>
      {view === 'edit' ? (
        <SurveyEditor />
      ) : (
        <div className="max-w-3xl">
          <p className="mb-4 text-sm text-slate-600">Answers from customers who gave 3 stars or fewer, with the question wording they saw at the time.</p>
          <FeedbackList mode="responses" timeZone={business.timezone} slug={business.slug} />
        </div>
      )}
    </div>
  )
}
