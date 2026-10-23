import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { Logo } from '../ui/ui'

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/survey', label: 'Survey' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/qr', label: 'QR & Link' },
  { to: '/settings', label: 'Settings' },
]

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium ${
                isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-xs text-slate-500" title={user?.email}>
          {user?.email}
        </p>
        <button onClick={signOut} className="mt-2 text-sm font-medium text-slate-700 hover:text-indigo-600">
          Log out
        </button>
      </div>
    </div>
  )
}

export default function AppLayout() {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-h-screen md:flex">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="sticky top-0 h-screen">
          <SideNav />
        </div>
      </aside>

      {/* mobile top bar + slide-over menu */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <Logo />
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-slate-300">
          Menu
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <SideNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 p-4 sm:p-8">
        <Outlet />
      </main>
    </div>
  )
}
