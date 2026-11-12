/* Shared primitives — Amethyst & Sage: flat surfaces, hairlines, no glow. */
import type { ReactNode } from 'react'
import { SEV_STYLE, STATUS_STYLE } from './lib/styles'

export function Badge({ children, className = '' }: {
  children: ReactNode; className?: string
}) {
  return (
    <span className={`inline-flex items-center border px-2 py-0.5
      text-[10px] font-semibold uppercase tracking-wider rounded-md
      ${className}`}>{children}</span>
  )
}

export function Btn({ children, onClick, kind = 'ghost', disabled,
                      type = 'button', className = '', title, 'data-tour': dataTour }: {
  children: ReactNode
  onClick?: () => void
  kind?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  title?: string
  'data-tour'?: string
}) {
  const kinds = {
    primary: 'btn-primary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
            data-tour={dataTour}
            className={`btn ${kinds[kind]} ${className}`}>
      {children}
    </button>
  )
}

export function Field({ label, children }: {
  label: string; children: ReactNode
}) {
  return (
    <label className="block">
      <span className="eyebrow block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="border border-dashed border-hairline bg-surface/40 rounded-lg
      px-4 py-8 text-center text-sm text-muted">
      {children}
    </div>
  )
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge className={SEV_STYLE[severity] ?? SEV_STYLE.suggestion}>
    {severity}
  </Badge>
}

export function StatusChip({ status }: { status: string }) {
  return <Badge className={STATUS_STYLE[status] ?? STATUS_STYLE.draft}>
    {status.replace('_', ' ')}
  </Badge>
}

/** CSS bar — width as % of max. */
export function Bar({ value, max, tone = 'ink' }: {
  value: number; max: number; tone?: 'ink' | 'accent' | 'critical'
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const color = {
    ink: 'bg-muted',
    accent: 'bg-accent',
    critical: 'bg-danger',
  }[tone]
  return (
    <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-[width]`}
           style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Tiny inline trend line — no chart lib needed for KPIs. */
export function Sparkline({ points, tone = 'accent', className = '' }: {
  points: number[]
  tone?: 'accent' | 'sage' | 'warn' | 'danger'
  className?: string
}) {
  const color = {
    accent: 'var(--color-accent)',
    sage: 'var(--color-sage)',
    warn: 'var(--color-warn)',
    danger: 'var(--color-danger)',
  }[tone]
  const w = 120
  const h = 28
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const span = max - min || 1
  const step = points.length > 1 ? w / (points.length - 1) : w
  const d = points
    .map((p, i) => {
      const x = i * step
      const y = h - 3 - ((p - min) / span) * (h - 6)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className={className} width="100%" height={h} viewBox={`0 0 ${w} ${h}`}
         preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-md bg-surface-3 ${className}`} />
  )
}
