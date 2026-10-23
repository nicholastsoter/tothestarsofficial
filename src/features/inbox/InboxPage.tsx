import { Link } from 'react-router-dom'
import { useBusiness } from '../../contexts/BusinessContext'
import FeedbackList from './FeedbackList'

export default function InboxPage() {
  const { business, loading } = useBusiness()
  if (loading) return <p className="text-sm text-slate-500" role="status">Loading…</p>
  if (!business) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="mt-2 text-slate-600">Create your business on the <Link to="/dashboard" className="font-medium text-indigo-600">Dashboard</Link> first.</p>
      </div>
    )
  }
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="mt-1 text-sm text-slate-600">Feedback your customers wrote or answered. Only you can see it, and your private notes.</p>
      </div>
      <FeedbackList mode="inbox" timeZone={business.timezone} slug={business.slug} />
    </div>
  )
}
