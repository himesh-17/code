import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles, ArrowRight, ArrowLeft, X,
  CheckCircle2, Compass, GripHorizontal
} from 'lucide-react'
import { type User } from '@/api'

type Role = 'guest' | 'creator' | 'reviewer' | 'manager' | 'admin'
type Advance = 'manual' | 'click' | 'login' | 'route'

interface TourStep {
  id: string
  title: string
  subtitle: string
  description: string
  role: Role
  route: string
  targetSelector?: string
  instruction: string
  badge: string
  advance?: Advance
  expectRole?: Exclude<Role, 'guest'>
  advanceRoute?: string
  signOut?: boolean
}

const AUTO_TOUR_STEPS: TourStep[] = [
  {
    id: 'hero-welcome',
    title: 'Welcome to BrandGuard AI',
    subtitle: 'The Governed Compliance Platform',
    description:
      'This tour walks the full brand lifecycle — Creator, Reviewer, Manager and Admin — using instant demo accounts. No setup required.',
    role: 'guest',
    route: '#/hero',
    targetSelector: '[data-tour="hero-demo-btn"]',
    instruction: 'Click "Try a demo role" to open the login center.',
    badge: 'Step 1: Hero Landing',
    advance: 'click',
  },
  {
    id: 'login-creator',
    title: 'Sign in as Creator',
    subtitle: 'Role 1 of 4',
    description:
      'Creators draft marketing copy and trigger autonomous AI evaluations. They cannot approve drafts or triage findings.',
    role: 'guest',
    route: '#/login',
    targetSelector: '[data-tour="demo-creator-btn"]',
    instruction: 'Click the Creator demo button to enter the workspace.',
    badge: 'Step 2: Creator Login',
    advance: 'login',
    expectRole: 'creator',
    signOut: true,
  },
  {
    id: 'creator-new',
    title: 'Creator: Start a Submission',
    subtitle: 'Draft new brand copy',
    description:
      'Everything is governed by the same RBAC as the API. A Creator can submit content but the approval gate stays out of reach.',
    role: 'creator',
    route: '#/review',
    targetSelector: '[data-tour="new-submission-btn"]',
    instruction: 'Click "New Submission" to open the draft form.',
    badge: 'Step 3: New Submission',
    advance: 'click',
  },
  {
    id: 'creator-form',
    title: 'Creator: Fill the Draft',
    subtitle: 'Title + copy body',
    description:
      'The title and copy body are what the AI evaluates. Channel and type are optional metadata used for routing and analytics.',
    role: 'creator',
    route: '',
    targetSelector: '[data-tour="create-form"]',
    instruction: 'Enter a title and some copy text, then continue.',
    badge: 'Step 4: Draft Details',
    advance: 'manual',
  },
  {
    id: 'creator-submit',
    title: 'Creator: Submit & Open',
    subtitle: 'Hand off to review',
    description:
      'Create & Open submits the draft and jumps straight into its review workspace, where the evaluation runs.',
    role: 'creator',
    route: '',
    targetSelector: '[data-tour="create-open-btn"]',
    instruction: 'Click "Create & Open" to submit the draft.',
    badge: 'Step 5: Submit Draft',
    advance: 'route',
    advanceRoute: 'review/',
  },
  {
    id: 'login-reviewer',
    title: 'Sign in as Reviewer',
    subtitle: 'Role 2 of 4',
    description:
      'Reviewers inspect AI-flagged violations citing exact brand rules. They resolve findings and peer threads, but cannot approve the draft.',
    role: 'guest',
    route: '#/login',
    targetSelector: '[data-tour="demo-reviewer-btn"]',
    instruction: 'Click the Reviewer demo button to continue.',
    badge: 'Step 6: Reviewer Login',
    advance: 'login',
    expectRole: 'reviewer',
    signOut: true,
  },
  {
    id: 'reviewer-queue',
    title: 'Reviewer: Open the Queue',
    subtitle: 'Newest draft on top',
    description:
      'Every submitted draft lands here with its SLA countdown. The most recent submission sits at the top of the queue.',
    role: 'reviewer',
    route: '#/review',
    targetSelector: '[data-tour="review-queue-row"]',
    instruction: 'Click the top draft to open its review workspace.',
    badge: 'Step 7: Review Queue',
    advance: 'click',
  },
  {
    id: 'reviewer-run',
    title: 'Reviewer: Run AI Evaluation',
    subtitle: 'Autonomous compliance pass',
    description:
      'The evaluation checks the draft against the live brand knowledge base and returns cited, severity-ranked findings.',
    role: 'reviewer',
    route: '',
    targetSelector: '[data-tour="run-eval-btn"]',
    instruction: 'Click "Run AI Evaluation" to generate findings.',
    badge: 'Step 8: AI Evaluation',
    advance: 'click',
  },
  {
    id: 'reviewer-finding',
    title: 'Reviewer: Triage the First Finding',
    subtitle: 'Generated Evaluation Summary & Findings',
    description:
      'Each finding cites the exact rule, the offending excerpt, its severity and a suggested fix. The top (most severe) finding is highlighted — this is what reviewers triage.',
    role: 'reviewer',
    route: '',
    targetSelector: '[data-tour="finding-first"]',
    instruction: 'Inspect the highlighted finding, then continue.',
    badge: 'Step 9: First Finding',
    advance: 'manual',
  },
  {
    id: 'login-manager',
    title: 'Sign in as Manager',
    subtitle: 'Role 3 of 4',
    description:
      'Managers hold shipping authority. Approval is blocked until every critical finding is resolved, and Managers also own the living brand knowledge base.',
    role: 'guest',
    route: '#/login',
    targetSelector: '[data-tour="demo-manager-btn"]',
    instruction: 'Click the Manager demo button to continue.',
    badge: 'Step 10: Manager Login',
    advance: 'login',
    expectRole: 'manager',
    signOut: true,
  },
  {
    id: 'manager-queue',
    title: 'Manager: Review the Draft',
    subtitle: 'Reopen the submission',
    description:
      'Managers reopen the same draft to make the final shipping decision, with the reviewer findings still attached.',
    role: 'manager',
    route: '#/review',
    targetSelector: '[data-tour="review-queue-row"]',
    instruction: 'Click the top draft to open it.',
    badge: 'Step 11: Manager Queue',
    advance: 'click',
  },
  {
    id: 'manager-actions',
    title: 'Manager: Approve or Request Changes',
    subtitle: 'The gated shipping decision',
    description:
      'Approve is disabled while any critical finding is unresolved. Request Changes sends the draft back to the creator for another pass.',
    role: 'manager',
    route: '',
    targetSelector: '[data-tour="manager-actions"]',
    instruction: 'These are the Manager-only decisions. Continue when ready.',
    badge: 'Step 12: Approval Gate',
    advance: 'manual',
  },
  {
    id: 'login-admin',
    title: 'Sign in as Admin',
    subtitle: 'Role 4 of 4',
    description:
      'Admins manage users and roles, and verify the hash-chained audit trail where zero actions go unlogged.',
    role: 'guest',
    route: '#/login',
    targetSelector: '[data-tour="demo-admin-btn"]',
    instruction: 'Click the Admin demo button to continue.',
    badge: 'Step 13: Admin Login',
    advance: 'login',
    expectRole: 'admin',
    signOut: true,
  },
  {
    id: 'admin-kpis',
    title: 'Admin: Portfolio KPIs',
    subtitle: 'Compliance at a glance',
    description:
      'Four live KPIs summarise the portfolio: approval rate, open criticals, drafts awaiting review and total LLM compute spent.',
    role: 'admin',
    route: '#/dashboard',
    targetSelector: '[data-tour="kpi-grid"]',
    instruction: 'These KPIs update as the workflow progresses.',
    badge: 'Step 14: Dashboard KPIs',
    advance: 'manual',
  },
  {
    id: 'admin-trend',
    title: 'Compliance Trend',
    subtitle: 'Chart 1 of 3',
    description:
      'The trend plots daily approval rate against submitted and flagged content, so you can see whether governance is improving over time.',
    role: 'admin',
    route: '#/dashboard',
    targetSelector: '[data-tour="chart-trend"]',
    instruction: 'Watch how the line responds as findings are resolved.',
    badge: 'Step 15: Trend Chart',
    advance: 'manual',
  },
  {
    id: 'admin-heatmap',
    title: 'Guideline-Gap Heat Map',
    subtitle: 'Chart 2 of 3',
    description:
      'The heat map cross-tabulates rule categories against severity. Darker cells show where your brand guidelines are most often broken.',
    role: 'admin',
    route: '#/dashboard',
    targetSelector: '[data-tour="chart-heatmap"]',
    instruction: 'Hot cells point to the rules that need attention.',
    badge: 'Step 16: Heat Map',
    advance: 'manual',
  },
  {
    id: 'admin-categories',
    title: 'Findings by Category',
    subtitle: 'Chart 3 of 3',
    description:
      'This ranks every rule category by total violations, revealing which policy area needs training or a guideline change first.',
    role: 'admin',
    route: '#/dashboard',
    targetSelector: '[data-tour="chart-categories"]',
    instruction: 'The longest bar is your biggest compliance gap.',
    badge: 'Step 17: Category Breakdown',
    advance: 'manual',
  },
  {
    id: 'finish',
    title: 'Walkthrough Complete',
    subtitle: 'Creator → Reviewer → Manager → Admin',
    description:
      'You have followed a single draft through all four roles: authored, evaluated, triaged, approved and audited. Click Finish to sign out.',
    role: 'admin',
    route: '',
    instruction: 'Finish the tour to return to the login screen.',
    badge: 'Step 18: Done',
    advance: 'manual',
  },
]

interface AutoSpotlightTourProps {
  currentUser: User | null
  isActive: boolean
  onClose: () => void
  onSwitchRole: (role: 'creator' | 'reviewer' | 'manager' | 'admin') => Promise<void>
  onSignOut: () => void
}

export default function AutoSpotlightTour({
  currentUser,
  isActive,
  onClose,
  onSwitchRole,
  onSignOut,
}: AutoSpotlightTourProps) {
  const [stepIndex, setStepIndex] = useState(() => {
    const isHero = typeof window !== 'undefined' && (
      window.location.hash.replace(/^#\/?/, '').split('/')[0] === 'hero' || window.location.hash === ''
    )
    if (isHero) return 0
    const saved = sessionStorage.getItem('brandguard_tour_step')
    return saved ? parseInt(saved, 10) || 0 : 0
  })
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const advancingRef = useRef(false)

  const currentStep = AUTO_TOUR_STEPS[stepIndex]

  const updateStep = (idx: number) => {
    setStepIndex(idx)
    sessionStorage.setItem('brandguard_tour_step', String(idx))
  }

  // Reset the advance guard whenever we land on a new step.
  useEffect(() => { advancingRef.current = false }, [stepIndex])

  // Always restart at step 0 when the tour is (re)opened on the hero.
  useEffect(() => {
    const onHash = () => {
      const isHero = typeof window !== 'undefined' && (
        window.location.hash.replace(/^#\/?/, '').split('/')[0] === 'hero' || window.location.hash === ''
      )
      if (isActive && isHero) {
        setStepIndex(0)
        sessionStorage.setItem('brandguard_tour_step', '0')
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [isActive])

  const finish = useCallback(() => {
    sessionStorage.removeItem('brandguard_tour_step')
    onSignOut()
    onClose()
  }, [onSignOut, onClose])

  const enterStep = useCallback(async (idx: number) => {
    const step = AUTO_TOUR_STEPS[idx]
    updateStep(idx)
    if (step.signOut) {
      onSignOut()
      window.location.hash = '#/login'
      return
    }
    if (step.role !== 'guest' && currentUser?.role !== step.role) {
      await onSwitchRole(step.role as 'creator' | 'reviewer' | 'manager' | 'admin')
    }
    if (step.route) window.location.hash = step.route
  }, [currentUser?.role, onSignOut, onSwitchRole])

  const advanceTo = useCallback((idx: number) => {
    if (idx >= AUTO_TOUR_STEPS.length) { finish(); return }
    if (advancingRef.current) return
    advancingRef.current = true
    void enterStep(idx)
  }, [finish, enterStep])

  // Advance when the expected role has logged in via the demo button.
  useEffect(() => {
    if (!isActive) return
    const step = AUTO_TOUR_STEPS[stepIndex]
    if (step.advance === 'login' && step.expectRole && currentUser?.role === step.expectRole) {
      advanceTo(stepIndex + 1)
    }
  }, [isActive, currentUser, stepIndex, advanceTo])

  // Advance after a successful submission navigates into the detail route.
  useEffect(() => {
    if (!isActive) return
    const step = AUTO_TOUR_STEPS[stepIndex]
    if (step.advance !== 'route' || !step.advanceRoute) return
    const check = () => {
      const h = window.location.hash.replace(/^#\/?/, '')
      if (h.startsWith(step.advanceRoute!) && h.length > step.advanceRoute!.length) {
        advanceTo(stepIndex + 1)
      }
    }
    check()
    window.addEventListener('hashchange', check)
    const t = setInterval(check, 400)
    return () => { window.removeEventListener('hashchange', check); clearInterval(t) }
  }, [isActive, stepIndex, advanceTo])

  // Advance when the user clicks the highlighted interactive target.
  useEffect(() => {
    if (!isActive) return
    const step = AUTO_TOUR_STEPS[stepIndex]
    if (step.advance !== 'click' || !step.targetSelector) return
    const onClick = (e: MouseEvent) => {
      const target = document.querySelector(step.targetSelector!)
      const node = e.target as Node | null
      if (target && node && (target === node || target.contains(node))) {
        advanceTo(stepIndex + 1)
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [isActive, stepIndex, advanceTo])

  // Scroll the target into view once per step.
  useEffect(() => {
    if (!isActive || !currentStep.targetSelector) return
    const el = document.querySelector(currentStep.targetSelector)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [isActive, stepIndex, currentStep])

  // Track the target's position while it is on screen.
  useEffect(() => {
    if (!isActive) return
    const updateRect = () => {
      if (!currentStep.targetSelector) { setHighlightRect(null); return }
      const el = document.querySelector(currentStep.targetSelector)
      if (!el) { setHighlightRect(null); return }
      const r = el.getBoundingClientRect()
      setHighlightRect((prev) => {
        if (prev && Math.abs(prev.x - r.x) < 1 && Math.abs(prev.y - r.y) < 1 &&
            Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1) {
          return prev
        }
        return r
      })
    }
    updateRect()
    const interval = setInterval(updateRect, 200)
    window.addEventListener('resize', updateRect, { passive: true })
    window.addEventListener('scroll', updateRect, { passive: true })
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect)
      setHighlightRect(null)
    }
  }, [isActive, currentStep, stepIndex])

  const handleNext = () => {
    if (stepIndex >= AUTO_TOUR_STEPS.length - 1) { finish(); return }
    const step = AUTO_TOUR_STEPS[stepIndex]
    if ((step.advance === 'click' || step.advance === 'route') && step.targetSelector) {
      const el = document.querySelector(step.targetSelector) as HTMLButtonElement | null
      if (el && !el.disabled) {
        el.click()
        return
      }
    }
    advanceTo(stepIndex + 1)
  }

  const handlePrev = () => {
    if (stepIndex > 0) {
      advancingRef.current = false
      void enterStep(stepIndex - 1)
    }
  }

  // Drag the card by its header.
  const onDragStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !cardRef.current) return
    const w = cardRef.current.offsetWidth
    const h = cardRef.current.offsetHeight
    const x = Math.min(Math.max(8, e.clientX - dragRef.current.dx), window.innerWidth - w - 8)
    const y = Math.min(Math.max(8, e.clientY - dragRef.current.dy), window.innerHeight - h - 8)
    setPos({ x, y })
  }
  const onDragEnd = (e: React.PointerEvent) => {
    dragRef.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  if (!isActive) return null

  // Spotlight hole geometry (padded around the target).
  const pad = 8
  const x1 = highlightRect ? Math.max(0, Math.floor(highlightRect.left - pad)) : 0
  const y1 = highlightRect ? Math.max(0, Math.floor(highlightRect.top - pad)) : 0
  const x2 = highlightRect ? Math.min(window.innerWidth, Math.ceil(highlightRect.right + pad)) : 0
  const y2 = highlightRect ? Math.min(window.innerHeight, Math.ceil(highlightRect.bottom + pad)) : 0
  const w = Math.max(0, x2 - x1)
  const h = Math.max(0, y2 - y1)

  // Place the card on the opposite vertical half from the target by default.
  const targetLow = highlightRect ? highlightRect.top > window.innerHeight / 2 : false
  const cardStyle: React.CSSProperties = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px` }
    : targetLow
      ? { top: '24px', right: '24px' }
      : { bottom: '24px', right: '24px' }

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* Four dimming panels leave the target crisp and never blur the whole page. */}
      {highlightRect && (
        <>
          <div className="fixed left-0 right-0 top-0 bg-black/60 backdrop-blur-[3px] pointer-events-auto"
               style={{ height: `${y1}px` }} />
          <div className="fixed left-0 right-0 bottom-0 bg-black/60 backdrop-blur-[3px] pointer-events-auto"
               style={{ top: `${y2}px` }} />
          <div className="fixed left-0 bg-black/60 backdrop-blur-[3px] pointer-events-auto"
               style={{ top: `${y1}px`, height: `${h}px`, width: `${x1}px` }} />
          <div className="fixed right-0 bg-black/60 backdrop-blur-[3px] pointer-events-auto"
               style={{ top: `${y1}px`, height: `${h}px`, left: `${x2}px` }} />

          <div
            className="fixed pointer-events-none rounded-xl border-2 border-accent shadow-[0_0_0_1px_rgba(163,147,191,0.3),0_0_30px_rgba(163,147,191,0.45)] z-[10000] transition-all duration-150"
            style={{ top: `${y1}px`, left: `${x1}px`, width: `${w}px`, height: `${h}px` }}
          >
            <div className="absolute -top-3.5 -right-3.5 flex h-7 w-7 items-center justify-center">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-7 w-7 bg-accent text-canvas font-bold text-xs items-center justify-center shadow-lg border border-white/20">
                {stepIndex + 1}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Floating tour card */}
      <div
        ref={cardRef}
        className="fixed z-[10001] pointer-events-auto w-[min(28rem,calc(100vw-32px))] bg-surface border border-hairline-strong rounded-xl shadow-2xl p-5 text-ink"
        style={cardStyle}
      >
        <div
          className="flex items-center justify-between pb-3 border-b border-hairline cursor-grab active:cursor-grabbing touch-none select-none"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-accent/20 border border-accent/40 grid place-items-center text-accent">
              <Compass className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '8s' }} />
            </div>
            <span className="text-xs font-bold tracking-wider uppercase font-mono text-accent">
              Guided Interactive Tour
            </span>
            <GripHorizontal className="w-4 h-4 text-faint" />
          </div>
          <button
            onClick={onClose}
            className="text-xs text-muted hover:text-ink px-2.5 py-1 rounded bg-surface-2 border border-hairline hover:border-accent/40 transition-colors flex items-center gap-1 cursor-pointer font-medium"
          >
            <span>Skip Tour</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between mt-3 text-xs">
          <span className="px-2 py-0.5 rounded bg-accent/10 border border-accent/25 text-accent font-semibold font-mono text-[11px]">
            {currentStep.badge}
          </span>
          <span className="text-muted font-mono text-[11px]">
            {stepIndex + 1} of {AUTO_TOUR_STEPS.length}
          </span>
        </div>

        <div className="mt-3">
          <h3 className="text-base font-bold text-ink tracking-tight flex items-center gap-2">
            {currentStep.title}
          </h3>
          <p className="text-xs text-accent/80 font-medium mt-0.5">
            {currentStep.subtitle}
          </p>
          <p className="text-xs text-muted leading-relaxed mt-2.5 bg-surface-2/60 p-3 rounded-lg border border-hairline">
            {currentStep.description}
          </p>
        </div>

        <div className="mt-3 p-2.5 rounded-md bg-accent/10 border border-accent/25 flex items-center gap-2 text-xs text-accent">
          <Sparkles className="w-4 h-4 shrink-0 text-accent" />
          <span className="font-medium">{currentStep.instruction}</span>
        </div>

        <div className="mt-5 pt-3 border-t border-hairline flex items-center justify-between">
          <button
            onClick={handlePrev}
            disabled={stepIndex === 0}
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Previous</span>
          </button>

          <div className="flex gap-1">
            {AUTO_TOUR_STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === stepIndex ? 'w-5 bg-accent' : 'w-1.5 bg-surface-3'
                }`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            className="btn btn-primary px-4 py-2 text-xs flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <span>{stepIndex === AUTO_TOUR_STEPS.length - 1 ? 'Finish Tour' : 'Next Step'}</span>
            {stepIndex === AUTO_TOUR_STEPS.length - 1 ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
