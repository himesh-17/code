import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { loadAuth, login, logout, ROLE_RANK, type User } from './api'
import { BrandLogo } from './components/ui/BrandLogo'
import { Toaster, toast } from 'sonner'
import {
  ArrowRight, BookOpen, Command, Compass, FileCheck2, LayoutDashboard, LogOut,
  Menu, Search, Shield, X,
} from 'lucide-react'

export { ROLE_RANK } from './api'

const DotGlobeHeroDemo = lazy(() => import('./components/ui/demo'))
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Review = lazy(() => import('./pages/Review'))
const KB = lazy(() => import('./pages/KB'))
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'))
const RoleTourGuide = lazy(() => import('./components/ui/RoleTourGuide'))
const AutoSpotlightTour = lazy(() => import('./components/ui/AutoSpotlightTour'))

function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse p-4 sm:p-6" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="h-7 bg-surface-2 rounded-md w-48 border border-hairline" />
        <div className="h-7 bg-surface-2 rounded-md w-24 border border-hairline" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 bg-surface-2 rounded-lg border border-hairline p-4 space-y-3">
            <div className="h-3 w-20 bg-surface-3 rounded" />
            <div className="h-6 w-16 bg-surface-3 rounded" />
          </div>
        ))}
      </div>
      <div className="h-72 bg-surface-2 rounded-lg border border-hairline" />
    </div>
  )
}

type Route = 'hero' | 'login' | 'dashboard' | 'review' | 'kb' | 'admin';

function parseHash(isLoggedIn: boolean): { route: Route; arg: string } {
  const h = location.hash.replace(/^#\/?/, '')
  const [head, arg = ''] = h.split('/')
  if (head === 'login') return { route: 'login', arg }
  if (head === 'review') return { route: 'review', arg }
  if (head === 'kb') return { route: 'kb', arg }
  if (head === 'dashboard') return { route: 'dashboard', arg }
  if (head === 'admin') return { route: 'admin', arg }
  if (head === 'hero') return { route: 'hero', arg }
  return { route: isLoggedIn ? 'dashboard' : 'hero', arg }
}

const NAV: { id: Route; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'review', label: 'Review Queue', icon: FileCheck2 },
  { id: 'kb', label: 'Knowledge Base', icon: BookOpen },
  { id: 'admin', label: 'Users', icon: Shield },
]

function NavLink({ n, active, onClick }: {
  n: (typeof NAV)[number]
  active: boolean
  onClick?: () => void
}) {
  const Icon = n.icon
  return (
    <a
      href={`#/${n.id}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 min-h-10 px-3 py-2.5 text-[13px] rounded-md border transition-colors ${
        active
          ? 'bg-accent/12 text-accent border-accent/30 font-semibold'
          : 'text-muted border-transparent hover:text-ink hover:bg-surface-2'
      }`}
    >
      <Icon className="w-4 h-4" strokeWidth={1.75} />
      <span>{n.label}</span>
    </a>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => loadAuth()?.user ?? null)
  const [path, setPath] = useState(() => parseHash(Boolean(user)))
  const [navOpen, setNavOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [autoTourActive, setAutoTourActive] = useState(() => {
    // Automatically launch when user lands on hero
    const initialRoute = parseHash(Boolean(loadAuth()?.user)).route
    return initialRoute === 'hero'
  })
  const [q, setQ] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const handleSwitchRole = async (role: 'creator' | 'reviewer' | 'manager' | 'admin') => {
    const creds: Record<string, { email: string; pw: string }> = {
      creator: { email: 'creator@brandguard.demo', pw: 'creator123' },
      reviewer: { email: 'reviewer@brandguard.demo', pw: 'reviewer123' },
      manager: { email: 'manager@brandguard.demo', pw: 'manager123' },
      admin: { email: 'admin@brandguard.demo', pw: 'admin12345' },
    }
    const target = creds[role]
    if (!target) return
    try {
      const newUser = await login(target.email, target.pw)
      setUser(newUser)
      setPath(parseHash(true))
      toast.success(`Switched role to ${role.toUpperCase()}`, {
        description: `Now viewing as ${newUser.email} (${newUser.team} team)`
      })
    } catch {
      toast.error(`Failed to switch to ${role}`)
    }
  }

  const handleSignOut = () => {
    logout()
    setUser(null)
    location.hash = '#/login'
    setPath({ route: 'login', arg: '' })
  }

  useEffect(() => {
    const on = () => {
      const nextPath = parseHash(Boolean(user))
      setPath(nextPath)
      setNavOpen(false)
      if (nextPath.route === 'hero') {
        sessionStorage.setItem('brandguard_tour_step', '0')
        setAutoTourActive(true)
      }
    }
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [user])

  // Clear any legacy permanent dismissal key so it doesn't suppress the tour
  useEffect(() => {
    try {
      localStorage.removeItem('brandguard_autotour_dismissed')
    } catch {}
  }, [])

  // Route protection: if guest tries to visit internal routes, route them to login
  useEffect(() => {
    if (!user && path.route !== 'login' && path.route !== 'hero') {
      location.hash = '#/login'
    }
    if (user && path.route === 'admin' && user.role !== 'admin') {
      location.hash = '#/dashboard'
    }
  }, [user, path.route])

  // Cmd/Ctrl+K opens the command palette; Esc closes overlays.
  const openCmd = () => {
    setQ('')
    setCmdOpen(true)
    requestAnimationFrame(() => searchRef.current?.focus())
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen((v) => {
          if (!v) {
            setQ('')
            requestAnimationFrame(() => searchRef.current?.focus())
          }
          return !v
        })
      }
      if (e.key === 'Escape') {
        setCmdOpen(false)
        setNavOpen(false)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const commands = useMemo(() => {
    const base = NAV.filter((n) => n.id !== 'admin' || user?.role === 'admin').map((n) => ({
      id: n.id as string,
      label: n.label,
      hint: `Go to ${n.label}`,
      run: () => { location.hash = `#/${n.id}`; setCmdOpen(false) },
    }))
    return [
      ...base,
      {
        id: 'autotour',
        label: 'Start Guided Spotlight Tour',
        hint: 'Auto-guided walkthrough with element spotlights',
        run: () => { setAutoTourActive(true); setCmdOpen(false) },
      },
      {
        id: 'tour',
        label: 'Interactive Role Tour',
        hint: 'Start guided 4-role compliance tour',
        run: () => { setTourOpen(true); setCmdOpen(false) },
      },
      {
        id: 'hero',
        label: 'Landing page',
        hint: 'View the public site',
        run: () => { location.hash = '#/hero'; setCmdOpen(false) },
      },
      {
        id: 'signout',
        label: 'Sign out',
        hint: 'End this session',
        run: () => { logout(); setUser(null); setCmdOpen(false) },
      },
    ]
  }, [user])

  const filtered = commands.filter((c) =>
    (c.label + ' ' + c.hint).toLowerCase().includes(q.toLowerCase()))

  if (path.route === 'hero') {
    return (
      <>
        <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
          <DotGlobeHeroDemo
            onLogin={() => {
              location.hash = '#/login'
              setPath({ route: 'login', arg: '' })
            }}
            onSignUp={() => {
              location.hash = '#/login'
              setPath({ route: 'login', arg: '' })
            }}
          />
        </Suspense>

        <AutoSpotlightTour
          currentUser={user}
          isActive={autoTourActive}
          onClose={() => {
            setAutoTourActive(false)
            sessionStorage.removeItem('brandguard_tour_step')
          }}
          onSwitchRole={handleSwitchRole}
          onSignOut={handleSignOut}
        />
        <Toaster theme="dark" position="top-right" />
      </>
    )
  }

  if (path.route === 'login' || !user) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <Login
          onLogin={(u) => {
            setUser(u)
            location.hash = '#/dashboard'
            setPath({ route: 'dashboard', arg: '' })
          }}
        />
        <AutoSpotlightTour
          currentUser={user}
          isActive={autoTourActive}
          onClose={() => {
            setAutoTourActive(false)
            sessionStorage.removeItem('brandguard_tour_step')
          }}
          onSwitchRole={handleSwitchRole}
          onSignOut={handleSignOut}
        />
        <RoleTourGuide
          currentUser={user}
          isOpen={tourOpen}
          onClose={() => setTourOpen(false)}
          onSwitchRole={handleSwitchRole}
        />

        <Toaster theme="dark" position="top-right" />
      </Suspense>
    )
  }

  const rail = (
    <>
      <div className="px-5 py-5 border-b border-hairline flex items-center justify-between">
        <a href="#/dashboard" className="flex items-center gap-3">
          <BrandLogo className="w-7 h-7" />
          <span>
            <span className="block text-sm font-bold tracking-tight text-ink leading-none">
              BrandGuard
            </span>
            <span className="block text-[10px] text-faint font-mono tracking-wider mt-1">
              COMPLIANCE AI
            </span>
          </span>
        </a>
        <span className="text-[10px] font-semibold text-accent bg-accent/12 px-2 py-0.5 rounded border border-accent/25">
          PRO
        </span>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-3" aria-label="Primary">
        {NAV.filter((n) => n.id !== 'admin' || user.role === 'admin').map((n) => (
          <NavLink key={n.id} n={n} active={path.route === n.id}
                   onClick={() => setNavOpen(false)} />
        ))}
      </nav>

      <div className="p-4 border-t border-hairline">
        <button
          onClick={openCmd}
          className="mb-3 w-full flex items-center gap-2 px-3 py-2 text-xs text-muted
            bg-surface-2 border border-hairline rounded-md hover:text-ink
            hover:border-hairline-strong transition-colors cursor-pointer"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="flex-1 text-left">Jump to…</span>
          <kbd className="font-mono text-[10px] text-faint border border-hairline-strong px-1.5 py-0.5 rounded">
            ⌘K
          </kbd>
        </button>

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-surface-3 border border-hairline-strong flex items-center justify-center font-bold text-xs text-accent">
            {user.email.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs truncate font-medium text-ink">{user.email}</div>
            <div className="text-[10px] text-muted flex items-center gap-1.5 capitalize mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
              {user.role} · {user.team}
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            logout()
            setUser(null)
            location.hash = '#/hero'
            setPath({ route: 'hero', arg: '' })
          }}
          className="mt-3 w-full flex items-center justify-center gap-2 py-1.5 text-xs
            text-muted hover:text-danger hover:bg-danger/10 rounded-md border
            border-hairline transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign out</span>
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50
        focus:top-3 focus:left-3 btn btn-primary">Skip to content</a>

      {/* Desktop rail */}
      <aside className="hidden lg:flex w-60 shrink-0 border-r border-hairline
        bg-surface flex-col fixed inset-y-0 left-0 z-30">
        {rail}
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface
            border-r border-hairline flex flex-col">
            <button
              onClick={() => setNavOpen(false)}
              aria-label="Close navigation"
              className="absolute top-4 right-4 p-2 min-w-10 min-h-10 grid place-items-center text-muted hover:text-ink rounded-md hover:bg-surface-2 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            {rail}
          </aside>
        </div>
      )}

      <div className="lg:ml-60 min-w-0 min-h-screen flex flex-col">
        {/* Top strip */}
        <div className="border-b border-hairline bg-surface px-4 sm:px-6 py-2.5
          flex items-center justify-between gap-3 sticky top-0 z-20">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 -ml-1 min-w-10 min-h-10 grid place-items-center text-muted hover:text-ink rounded-md hover:bg-surface-2 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="w-2 h-2 rounded-full bg-sage inline-block shrink-0" />
            <span className="text-xs text-muted truncate">
              <strong className="text-ink font-semibold">AI advisory active</strong>
              <span className="hidden sm:inline"> — automated rules run; a human always signs off.</span>
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => setTourOpen((t) => !t)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-accent/15 border border-accent/35 text-accent hover:bg-accent/25 transition-all cursor-pointer shadow-sm"
            >
              <Compass className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Role Tour</span>
            </button>
            <button
              onClick={openCmd}
              aria-label="Open command palette"
              className="p-2 min-w-10 min-h-10 grid place-items-center text-muted hover:text-ink rounded-md hover:bg-surface-2 cursor-pointer"
            >
              <Command className="w-4 h-4" />
            </button>
            <span className="text-[11px] text-faint font-mono hidden sm:block">
              V1.0 · GROQ
            </span>
          </div>
        </div>

        <main id="main" className="px-4 sm:px-6 py-6 sm:py-8 max-w-7xl w-full mx-auto flex-1">
          <Suspense fallback={<PageSkeleton />}>
            {path.route === 'dashboard' && <Dashboard />}
            {path.route === 'review' && <Review key={path.arg || 'list'} selected={path.arg} user={user} />}
            {path.route === 'kb' && <KB user={user} />}
            {path.route === 'admin' && ROLE_RANK[user.role] >= ROLE_RANK.admin && <AdminUsersPage user={user} />}
          </Suspense>
        </main>

        <footer className="border-t border-hairline px-6 py-4 text-[11px] text-faint
          flex flex-wrap items-center justify-between gap-2">
          <span>Advisory findings · human sign-off · tamper-evident audit trail</span>
          <span className="font-mono">BrandGuard AI · v1.0</span>
        </footer>
      </div>

      {/* Command palette */}
      {cmdOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
             role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="absolute inset-0 bg-black/65" onClick={() => setCmdOpen(false)} />
          <div className="relative w-full max-w-lg bg-surface border border-hairline-strong
            rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 border-b border-hairline">
              <Search className="w-4 h-4 text-faint shrink-0" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered[0]) filtered[0].run()
                }}
                placeholder="Jump to a page or action…"
                aria-label="Search commands"
                className="w-full bg-transparent py-3.5 text-sm text-ink
                  placeholder:text-faint focus:outline-none"
              />
              <kbd className="font-mono text-[10px] text-faint border border-hairline-strong
                px-1.5 py-0.5 rounded shrink-0">ESC</kbd>
            </div>
            <ul className="max-h-72 overflow-y-auto py-2">
              {filtered.length === 0 && (
                <li className="px-4 py-6 text-sm text-muted text-center">No matches.</li>
              )}
              {filtered.map((c, i) => (
                <li key={c.id}>
                  <button
                    onClick={c.run}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left
                      text-sm transition-colors cursor-pointer ${
                        i === 0 ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'
                      }`}
                  >
                    <ArrowRight className="w-3.5 h-3.5 text-accent shrink-0" />
                    <span className="flex-1">{c.label}</span>
                    <span className="text-[11px] text-faint">{c.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Role Tour Guide */}
      <Suspense fallback={null}>
        <RoleTourGuide
          currentUser={user}
          isOpen={tourOpen}
          onClose={() => setTourOpen(false)}
          onSwitchRole={handleSwitchRole}
        />

        {/* Auto Spotlight Tour (Global Blocking Guided Walkthrough) */}
        <AutoSpotlightTour
          currentUser={user}
          isActive={autoTourActive}
          onClose={() => {
            setAutoTourActive(false)
            sessionStorage.removeItem('brandguard_tour_step')
          }}
          onSwitchRole={handleSwitchRole}
          onSignOut={handleSignOut}
        />
      </Suspense>

      <Toaster theme="dark" position="top-right" />
    </div>
  )
}
