import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import { AuthProvider } from './contexts/AuthContext'
import { BusinessProvider } from './contexts/BusinessContext'
import DashboardPage from './features/onboarding/DashboardPage'
import ForgotPasswordPage from './features/auth/ForgotPasswordPage'
import { FullPageSpinner, RedirectIfSignedIn, RequireAuth } from './features/auth/guards'
import LoginPage from './features/auth/LoginPage'
import ResetPasswordPage from './features/auth/ResetPasswordPage'
import SignupPage from './features/auth/SignupPage'
import VerifyEmailPage from './features/auth/VerifyEmailPage'
import { configError } from './lib/supabase'

// heavier pages load only when opened (the QR page pulls in the QR and PDF libraries)
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'))
const QrPage = lazy(() => import('./features/qr/QrPage'))

function ComingSoon({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-slate-600">This page is built in Phase {phase}.</p>
    </div>
  )
}

function NotFound() {
  return <main className="flex min-h-screen items-center justify-center p-6 text-slate-600">Page not found.</main>
}

/** Everything except the public review page: auth, the dashboard, and settings. */
export default function AuthedApp() {
  if (configError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center p-6 text-sm text-red-800">
        <p role="alert">{configError}</p>
      </main>
    )
  }

  return (
    <AuthProvider>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route element={<RedirectIfSignedIn />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route
              element={
                <BusinessProvider>
                  <AppLayout />
                </BusinessProvider>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/survey" element={<ComingSoon title="Survey" phase={3} />} />
              <Route path="/analytics" element={<ComingSoon title="Analytics" phase={4} />} />
              <Route path="/qr" element={<QrPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
