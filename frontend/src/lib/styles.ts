/* Amethyst & Sage style constants and calculation helpers */

export const tint = (v: string, pct = 12) =>
  `color-mix(in oklab, ${v} ${pct}%, transparent)`

export const SEV_STYLE: Record<string, string> = {
  critical: 'text-danger border-danger/40 bg-danger/10',
  warning: 'text-warn border-warn/40 bg-warn/10',
  suggestion: 'text-muted border-hairline-strong bg-surface-2',
}

export const STATUS_STYLE: Record<string, string> = {
  draft: 'text-muted border-hairline-strong bg-surface-2',
  review: 'text-warn border-warn/40 bg-warn/10',
  peer_review: 'text-warn border-warn/40 bg-warn/10',
  changes: 'text-danger border-danger/40 bg-danger/10',
  approved: 'text-sage border-sage/40 bg-sage/10',
  published: 'text-sage border-sage/40 bg-sage/10',
}

export const inputCls = 'input'

/** Shared heat-cell tone so dashboard and tables agree. */
export function heatStyle(count: number, max: number, sev: string) {
  if (!count) return { background: 'var(--color-surface-2)', color: 'var(--color-faint)' }
  const a = 0.18 + 0.72 * (count / Math.max(max, 1))
  const rgb = sev === 'critical' ? '229,138,138'
    : sev === 'warning' ? '217,185,120'
      : '154,147,166'
  return {
    background: `rgba(${rgb},${a.toFixed(2)})`,
    color: 'var(--color-ink)',
  }
}
