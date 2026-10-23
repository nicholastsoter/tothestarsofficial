import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

// Two separate bundles: the public review page (what customers load on their phones) never
// downloads the login, dashboard or Supabase client code.
const PublicReviewPage = lazy(() => import('./features/public-review/PublicReviewPage'))
const AuthedApp = lazy(() => import('./AuthedApp'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500" role="status">Loading…</div>}>
        <Routes>
          <Route path="/r/:slug" element={<PublicReviewPage />} />
          <Route path="/*" element={<AuthedApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
