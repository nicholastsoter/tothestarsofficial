import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-500" role="status">
      Loading…
    </div>
  )
}

/** Wraps every page that needs a signed-in user. */
export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/** Wraps login/signup: signed-in users go straight to the app. */
export function RedirectIfSignedIn() {
  const { user, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (user) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
