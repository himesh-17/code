import { useState } from 'react'
import { login, type User } from '../api'
import { ArrowLeft, ArrowRight, Lock, Mail, ShieldCheck, UserCheck } from 'lucide-react'
import { BrandLogo } from '../components/ui/BrandLogo'

const DEMOS = [
  { label: 'Creator', email: 'creator@brandguard.demo', pw: 'creator123', desc: 'Author copy' },
  { label: 'Reviewer', email: 'reviewer@brandguard.demo', pw: 'reviewer123', desc: 'Approve & comment' },
  { label: 'Manager', email: 'manager@brandguard.demo', pw: 'manager123', desc: 'Manage rules & KB' },
  { label: 'Admin', email: 'admin@brandguard.demo', pw: 'admin12345', desc: 'Full system control' },
]

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e?: { email: string; pw: string }) {
    if (busy) return
    const em = e?.email ?? email
    const password = e?.pw ?? pw
    setBusy(true)
    setErr('')
    try {
      const user = await login(em, password)
      onLogin(user)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between py-6">
        <a href="#/hero"
           className="inline-flex items-center gap-2 text-xs font-semibold text-muted
             hover:text-ink px-3 py-2 rounded-md bg-surface-2 border border-hairline
             transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </a>
        <div className="flex items-center gap-2.5">
          <BrandLogo className="w-7 h-7" />
          <span className="text-base font-bold tracking-tight text-ink">BrandGuard</span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6
        grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        {/* Editorial panel */}
        <section className="hidden lg:block">
          <span className="eyebrow">Governed brand review</span>
          <h1 className="font-serif text-5xl xl:text-6xl leading-[1.02] tracking-tight mt-4">
            Every word,
            <br />
            <em className="italic text-accent">accounted for.</em>
          </h1>
          <p className="text-muted text-base leading-relaxed max-w-md mt-6">
            Review copy against your brand knowledge base, with evidence,
            human sign-off, and a tamper-evident audit trail.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-muted">
            {[
              'Deterministic rules + governed LLM findings',
              'Human approval is always the final gate',
              'SLA timers, heat maps and team compliance',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-sage shrink-0 mt-0.5" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Form card */}
        <div className="w-full max-w-[440px] mx-auto lg:mx-0 justify-self-center lg:justify-self-end">
          <div className="card p-6 sm:p-8">
            <span className="eyebrow">Secure access</span>
            <h2 className="text-xl font-bold tracking-tight mt-2 mb-1">
              Sign in to BrandGuard
            </h2>
            <p className="text-xs text-muted mb-6 leading-relaxed">
              Use a demo role below, or sign in with your work email.
            </p>

            <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-4">
              <div>
                <label htmlFor="email"
                       className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Work email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="input pl-10"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password"
                       className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="••••••••"
                    className="input pl-10"
                  />
                </div>
              </div>

              {err && (
                <div role="alert" className="text-xs text-danger border border-danger/30
                  bg-danger/10 px-3.5 py-2.5 rounded-md flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
                  <span>{err}</span>
                </div>
              )}

              <button type="submit" disabled={busy}
                      className="btn btn-primary w-full py-3 mt-2">
                {busy ? (
                  <>
                    <span className="w-4 h-4 border-2 border-canvas/30 border-t-canvas rounded-full animate-spin" />
                    <span>Signing in…</span>
                  </>
                ) : (
                  <>
                    <span>Sign in</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-hairline">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                  Instant demo access
                </span>
                <span className="text-[10px] text-accent font-medium">One-click roles</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {DEMOS.map((d) => (
                  <button
                    key={d.email}
                    type="button"
                    data-tour={`demo-${d.label.toLowerCase()}-btn`}
                    onClick={() => submit(d)}
                    disabled={busy}
                    className="p-2.5 rounded-md bg-surface-2 hover:bg-surface-3
                      border border-hairline hover:border-accent/40 text-left
                      transition-colors group cursor-pointer disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-ink group-hover:text-accent transition-colors">
                        {d.label}
                      </span>
                      <UserCheck className="w-3.5 h-3.5 text-faint group-hover:text-accent transition-colors" />
                    </div>
                    <span className="text-[11px] text-muted block mt-0.5 truncate">
                      {d.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-5 text-xs text-faint
        flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-hairline">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-sage" />
          <span>Advisory findings with human sign-off</span>
        </div>
        <div className="flex gap-4 text-muted">
          <a href="#/hero" className="hover:text-ink transition-colors">Overview</a>
          <span>·</span>
          <span>Version 1.0 Enterprise</span>
        </div>
      </footer>
    </div>
  )
}
