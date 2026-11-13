import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, CheckCircle2, FileSearch, Gauge, GitBranch, LayoutDashboard,
  LogIn, ScanLine, ShieldCheck, Sparkles, UserPlus,
} from 'lucide-react'
import { loadAuth } from '@/api'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { AsciiArt } from '@/components/ui/lol'

export interface DotGlobeHeroDemoProps {
  onLogin?: () => void
  onSignUp?: () => void
}

/** Reveal on scroll — one observer for every `.reveal` in the page. */
function useReveal() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in')
          io.unobserve(e.target)
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

const STEPS = [
  { icon: FileSearch, title: 'Submit copy', body: 'Drop in a draft, email, social post or image. Channel and team are recorded automatically.' },
  { icon: ScanLine, title: 'Run the review', body: 'Deterministic rules plus a governed LLM return findings with severity, evidence and a fix suggestion.' },
  { icon: CheckCircle2, title: 'Human sign-off', body: 'A reviewer accepts or dismisses every finding. Approval is the only path to publish — and it is audited.' },
]

const FEATURES = [
  { icon: ShieldCheck, title: 'Evidence-backed findings', body: 'Every finding cites the fact, guideline or glossary term it was checked against.' },
  { icon: Gauge, title: 'SLA monitors', body: 'Review deadlines are tracked per draft; breaches surface before they ship.' },
  { icon: GitBranch, title: 'Tamper-evident audit', body: 'Hash-chained log of every action, actor and model call.' },
  { icon: Sparkles, title: 'Governed LLM', body: 'Groq, OpenAI or a deterministic fallback — the same contract either way.' },
]

export default function DotGlobeHeroDemo({ onLogin, onSignUp }: DotGlobeHeroDemoProps) {
  const user = loadAuth()?.user
  const root = useRef<HTMLDivElement>(null)
  const [showCta, setShowCta] = useState(false)
  useReveal()

  useEffect(() => {
    const on = () => setShowCta(scrollY > innerHeight * 0.9)
    on()
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])

  const handleLogin = () => {
    if (onLogin) onLogin()
    else window.location.hash = '#/login'
  }
  const handleSignUp = () => {
    if (onSignUp) onSignUp()
    else window.location.hash = '#/login'
  }

  return (
    <div ref={root} className="bg-canvas text-ink">
      {/* Fixed nav */}
      <header className="fixed top-0 inset-x-0 z-30 border-b border-hairline bg-canvas/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <a href="#/hero" className="flex items-center gap-2.5 py-2">
            <BrandLogo className="w-7 h-7" />
            <span className="text-base font-bold tracking-tight">BrandGuard</span>
          </a>
          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-muted" aria-label="Sections">
            <a href="#how" className="inline-flex items-center min-h-10 hover:text-ink transition-colors">How it works</a>
            <a href="#features" className="inline-flex items-center min-h-10 hover:text-ink transition-colors">Features</a>
            <a href="#preview" className="inline-flex items-center min-h-10 hover:text-ink transition-colors">Product</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <a href="#/dashboard" className="btn btn-primary">
                <LayoutDashboard className="w-4 h-4" />
                Dashboard ({user.role})
              </a>
            ) : (
              <>
                <button onClick={handleLogin} className="btn btn-ghost hidden sm:inline-flex">
                  Sign in
                </button>
                <button onClick={handleSignUp} className="btn btn-primary">
                  <LogIn className="w-4 h-4" />
                  Demo access
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative bg-canvas min-h-screen flex items-center justify-center overflow-hidden">
        {/* Full-screen ASCII background behind hero text */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-45 mix-blend-screen overflow-hidden">
          <AsciiArt className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-canvas/70 via-canvas/30 to-canvas" />
          <div className="absolute inset-0 bg-radial-gradient from-transparent via-canvas/50 to-canvas" />
        </div>

        <div className="relative z-10 w-full max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-24 text-center">
          <span className="reveal inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full
            bg-surface-2/90 backdrop-blur-md border border-hairline-strong text-[11px] font-semibold uppercase
            tracking-wider text-accent shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
            Autonomous brand governance
          </span>

          {/* No .reveal here: the headline is the LCP element, and a fade-in
              starts it at opacity 0 — which disqualifies it from LCP. */}
          <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl xl:text-8xl leading-[0.98]
            tracking-tight mt-6">
            Brand integrity,
            <br />
            <em className="italic text-accent">governed</em> end to end.
          </h1>

          <p className="reveal text-muted sm:text-ink/80 text-base sm:text-lg md:text-xl leading-relaxed
            max-w-2xl mx-auto mt-6" style={{ transitionDelay: '120ms' }}>
            Review every draft against your knowledge base — with evidence,
            SLA timers, human sign-off and a tamper-evident audit trail.
          </p>

          <div className="reveal flex flex-col sm:flex-row gap-3.5 justify-center items-center mt-9"
               style={{ transitionDelay: '180ms' }}>
            <button
              onClick={handleSignUp}
              data-tour="hero-demo-btn"
              className="btn btn-primary px-6 py-3.5 text-sm shadow-md"
            >
              <UserPlus className="w-4 h-4" />
              Try a demo role
              <ArrowRight className="w-4 h-4" />
            </button>
            <a href="#how" className="btn btn-ghost px-6 py-3.5 text-sm backdrop-blur-sm bg-surface-2/50 border border-hairline">
              See how it works
            </a>
          </div>

          <p className="reveal text-xs text-faint mt-8" style={{ transitionDelay: '240ms' }}>
            Advisory AI findings · human-in-the-loop approvals · hash-chained audit
          </p>
        </div>
      </section>

      {/* STATS */}
      <section className="border-y border-hairline bg-surface">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            ['5', 'review categories'],
            ['100%', 'human sign-off'],
            ['7/30/90d', 'compliance trends'],
            ['0', 'unlogged approvals'],
          ].map(([n, l], i) => (
            <div key={l} className="reveal" style={{ transitionDelay: `${i * 60}ms` }}>
              <div className="font-serif text-4xl tracking-tight">{n}</div>
              <div className="text-xs text-muted mt-1">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div className="reveal max-w-2xl">
          <span className="eyebrow">How it works</span>
          <h2 className="font-serif text-4xl sm:text-5xl tracking-tight mt-3">
            Three steps, one accountable trail.
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5 mt-10">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            return (
              <div key={s.title} className="reveal card p-6"
                   style={{ transitionDelay: `${i * 90}ms` }}>
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-md bg-accent/12 border border-accent/25
                    grid place-items-center text-accent">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="font-mono text-xs text-faint">0{i + 1}</span>
                </div>
                <h3 className="text-base font-semibold mt-4">{s.title}</h3>
                <p className="text-sm text-muted leading-relaxed mt-2">{s.body}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* BENTO */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        <div className="reveal flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <span className="eyebrow">Features</span>
            <h2 className="font-serif text-4xl sm:text-5xl tracking-tight mt-3">
              Built for teams that ship copy.
            </h2>
          </div>
          <p className="text-sm text-muted max-w-sm">
            Every surface is designed around one question: can this claim be defended?
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <div key={f.title} className="reveal panel p-5"
                   style={{ transitionDelay: `${i * 70}ms` }}>
                <Icon className="w-5 h-5 text-accent" />
                <h3 className="text-sm font-semibold mt-3">{f.title}</h3>
                <p className="text-xs text-muted leading-relaxed mt-1.5">{f.body}</p>
              </div>
            )
          })}
        </div>

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 mt-4">
          <div className="reveal card p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Guideline-gap heat map</h3>
              <span className="text-[11px] text-faint">category × severity</span>
            </div>
            <div className="mt-5 space-y-2">
              {['tone', 'claim', 'term', 'a11y', 'visual'].map((c, i) => (
                <div key={c} className="grid grid-cols-[64px_1fr] items-center gap-3">
                  <span className="text-[11px] text-muted capitalize">{c}</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0.85, 0.45, 0.22].map((a, j) => (
                      <div key={j} className="h-7 rounded-sm"
                           style={{ background: `color-mix(in oklab, var(--color-accent) ${(a * 100) - i * 8}%, var(--color-surface-2))` }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="reveal panel p-6" style={{ transitionDelay: '80ms' }}>
            <h3 className="text-sm font-semibold">Review queue</h3>
            <ul className="mt-4 space-y-3 text-xs">
              {[
                ['Enterprise launch copy', 'Approved', 'text-sage'],
                ['Partner one-pager', 'Review', 'text-warn'],
                ['Paid social claim', 'Changes', 'text-danger'],
                ['Product factsheet', 'Draft', 'text-muted'],
              ].map(([t, s, c]) => (
                <li key={t} className="flex items-center justify-between gap-3
                  border-b border-hairline pb-2 last:border-0">
                  <span className="truncate text-ink">{t}</span>
                  <span className={`${c} font-semibold uppercase tracking-wider text-[10px]`}>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* PRODUCT PREVIEW */}
      <section id="preview" className="border-y border-hairline bg-surface">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 grid lg:grid-cols-[0.9fr_1.1fr] gap-10 items-center">
          <div className="reveal">
            <span className="eyebrow">Product</span>
            <h2 className="font-serif text-4xl sm:text-5xl tracking-tight mt-3">
              A dashboard that answers “are we safe to publish?”
            </h2>
            <p className="text-sm text-muted leading-relaxed mt-4 max-w-md">
              Compliance rate, open criticals, SLA breaches and team performance —
              three to five primary numbers, with detail on demand.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-muted">
              {['Role-aware dashboards for creators, reviewers and managers',
                'Trend chart over 7, 30 or 90 days',
                'Team and rule drill-downs without mixing time windows'].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-sage shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="reveal card p-4 sm:p-5" style={{ transitionDelay: '80ms' }}>
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent" />
                <span className="text-xs font-semibold">Compliance dashboard</span>
              </div>
              <div className="flex gap-1 text-[10px] font-mono">
                {['7d', '30d', '90d'].map((d, i) => (
                  <span key={d} className={`px-2 py-1 rounded ${i === 1 ? 'bg-accent/15 text-accent' : 'text-faint'}`}>{d}</span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              {[['94.2%', 'Compliance', 'text-sage'], ['07', 'Criticals', 'text-danger'],
                ['21', 'Awaiting', 'text-warn'], ['128', 'Facts', 'text-accent']].map(([v, l, c]) => (
                <div key={l} className="panel p-3">
                  <div className="text-[10px] text-faint uppercase tracking-wider">{l}</div>
                  <div className={`font-mono text-xl mt-1 ${c}`}>{v}</div>
                </div>
              ))}
            </div>
            <div className="panel p-3 mt-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted">Compliance trend</span>
                <span className="text-[10px] text-faint">30 days</span>
              </div>
              <svg viewBox="0 0 420 90" className="w-full h-24 mt-2" preserveAspectRatio="none" aria-hidden="true">
                {[20, 45, 70].map((y) => (
                  <line key={y} x1="0" y1={y} x2="420" y2={y} stroke="var(--color-hairline)" strokeWidth="1" />
                ))}
                <path d="M0,74 L60,70 L120,66 L180,58 L240,52 L300,40 L360,34 L420,22 L420,90 L0,90 Z"
                      fill="rgba(163,147,191,0.10)" />
                <path d="M0,74 L60,70 L120,66 L180,58 L240,52 L300,40 L360,34 L420,22"
                      fill="none" stroke="var(--color-accent)" strokeWidth="2" />
                <path d="M0,80 L60,78 L120,80 L180,74 L240,76 L300,68 L360,70 L420,64"
                      fill="none" stroke="var(--color-warn)" strokeWidth="1.5" strokeDasharray="4 4" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-24 text-center">
        <div className="reveal">
          <span className="eyebrow">Start here</span>
          <h2 className="font-serif text-4xl sm:text-6xl tracking-tight mt-4 max-w-3xl mx-auto">
            Publish with evidence, not hope.
          </h2>
          <p className="text-muted text-sm sm:text-base mt-4 max-w-xl mx-auto">
            Open a demo role and run a draft through the full review, approval and audit flow.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
            <button onClick={handleSignUp} className="btn btn-primary px-6 py-3 text-sm">
              <UserPlus className="w-4 h-4" />
              Try a demo role
            </button>
            <button onClick={handleLogin} className="btn btn-ghost px-6 py-3 text-sm">
              <LogIn className="w-4 h-4" />
              Sign in
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row
          items-center justify-between gap-3 text-xs text-faint">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="w-6 h-6" />
            <span>BrandGuard AI — advisory findings, human sign-off.</span>
          </div>
          <div className="flex gap-1 text-muted">
            <a href="#how" className="inline-flex items-center justify-center min-h-10 min-w-10 px-2 hover:text-ink transition-colors">How it works</a>
            <a href="#features" className="inline-flex items-center justify-center min-h-10 min-w-10 px-2 hover:text-ink transition-colors">Features</a>
            <a href="#/login" className="inline-flex items-center justify-center min-h-10 min-w-10 px-2 hover:text-ink transition-colors">Sign in</a>
          </div>
        </div>
      </footer>

      {/* Sticky CTA after hero */}
      <div className={`fixed bottom-0 inset-x-0 z-30 border-t border-hairline bg-surface
        transition-transform duration-300 ${showCta ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <p className="text-xs text-muted hidden sm:block">
            <strong className="text-ink">Ready to see it on your copy?</strong> Demo roles open instantly.
          </p>
          <div className="flex gap-2 ml-auto">
            <button onClick={handleLogin} className="btn btn-ghost">Sign in</button>
            <button onClick={handleSignUp} className="btn btn-primary">
              Try a demo role <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { DotGlobeHeroDemo }
