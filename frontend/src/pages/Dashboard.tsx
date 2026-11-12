import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  api, loadAuth, msg, type Analytics, type Content, type TrendResponse,
  type User,
} from '../api'
import { Bar, Badge, Empty, StatusChip, Sparkline, Skeleton } from '../ui'
import { heatStyle } from '../lib/styles'
import { toast } from 'sonner'
import {
  AlertCircle, AlertTriangle, CheckCircle2, Cpu, FileText, TrendingUp,
} from 'lucide-react'

const TrendChart = lazy(() => import('../components/charts/TrendChart'))

const CATS = ['tone', 'term', 'claim', 'a11y', 'visual']
const SEVS = ['critical', 'warning', 'suggestion']

function Kpi({ label, value, sub, tone, icon: Icon, spark, sparkTone }: {
  label: string
  value: string
  sub?: string
  tone?: string
  icon?: React.ElementType
  spark?: number[]
  sparkTone?: 'accent' | 'sage' | 'warn' | 'danger'
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
        {Icon && <Icon className="w-4 h-4 text-faint" />}
      </div>
      <div className={`text-3xl font-bold tabular-nums tracking-tight mt-2 ${tone ?? 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
      {spark && spark.length > 1 && (
        <Sparkline points={spark} tone={sparkTone ?? 'accent'} className="mt-3" />
      )}
    </div>
  )
}

function Section({ title, right, children, tourId }: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
  tourId?: string
}) {
  return (
    <section data-tour={tourId} className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-hairline">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">{title}</h2>
        {right}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-label={label}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-5 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="card p-5 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-[240px] w-full" />
      </div>
    </div>
  )
}

function dailyCounts(rows: Content[], days = 7) {
  const out = Array(days).fill(0)
  const now = Date.now()
  for (const r of rows) {
    const t = new Date(r.created_at.replace(' ', 'T') + 'Z').getTime()
    const idx = days - 1 - Math.floor((now - t) / 86400000)
    if (idx >= 0 && idx < days) out[idx] += 1
  }
  return out
}

function PersonalDashboard({ user }: { user: User }) {
  const [rows, setRows] = useState<Content[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api<Content[]>('/content')
      .then(setRows)
      .catch((e) => {
        const m = msg(e)
        setErr(m)
        toast.error('Could not load your workspace', { description: m })
      })
  }, [])

  const { mine, approved, pending, changes, rate, recent } = useMemo(() => {
    if (!rows) return { mine: [] as Content[], approved: 0, pending: 0, changes: 0, rate: 0, recent: [] as number[] }
    const m = user.role === 'creator'
      ? rows.filter((r) => r.created_by === user.email)
      : rows
    const a = m.filter((r) => r.status === 'approved' || r.status === 'published').length
    const p = m.filter((r) => ['draft', 'review', 'peer_review'].includes(r.status)).length
    const c = m.filter((r) => r.status === 'changes').length
    const rt = m.length ? Math.round((a / m.length) * 100) : 0
    const rc = dailyCounts(m, 7)
    return { mine: m, approved: a, pending: p, changes: c, rate: rt, recent: rc }
  }, [rows, user.role, user.email])

  if (err) {
    return (
      <div role="alert" className="text-danger text-sm p-4 bg-danger/10 rounded-lg border border-danger/30">
        {err}
      </div>
    )
  }
  if (!rows) return <Loading label="Loading your workspace" />

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <span className="eyebrow">{user.role} workspace</span>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight mt-1">
            {user.role === 'creator' ? 'Your submissions' : 'Review queue'}
          </h1>
          <p className="text-sm text-muted mt-1">
            {user.role === 'creator'
              ? 'Track every draft and its review status.'
              : 'Content awaiting your review and its current status.'}
          </p>
        </div>
        <a href="#/review" className="btn btn-ghost self-start sm:self-auto">
          <FileText className="w-4 h-4" />
          {user.role === 'creator' ? 'New submission' : 'Open queue'}
        </a>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Submissions" value={String(mine.length)} sub="In your scope"
             icon={FileText} spark={recent} sparkTone="accent" />
        <Kpi label="Approved" value={String(approved)} sub={`${rate}% approval rate`}
             tone="text-sage" icon={CheckCircle2} />
        <Kpi label="Awaiting review" value={String(pending)} sub="Pending a decision"
             tone={pending ? 'text-warn' : 'text-ink'} icon={AlertTriangle} />
        <Kpi label="Changes requested" value={String(changes)} sub="Needs edits"
             tone={changes ? 'text-danger' : 'text-ink'} icon={AlertCircle} />
      </div>

      <Section title="Content"
               right={<span className="text-[11px] text-faint">{mine.length} total</span>}>
        {mine.length === 0 ? (
          <Empty>No content in your scope yet.</Empty>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-faint uppercase tracking-wider text-[11px] border-b border-hairline">
                  <th className="pb-2.5 text-left font-semibold">Title</th>
                  <th className="pb-2.5 text-left font-semibold hidden sm:table-cell">Channel</th>
                  <th className="pb-2.5 text-left font-semibold hidden md:table-cell">Author</th>
                  <th className="pb-2.5 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {mine.slice(0, 25).map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2 transition-colors">
                    <td className="py-3 font-semibold text-ink max-w-[22rem] truncate pr-3">
                      <a href={`#/review/${r.id}`} className="hover:text-accent transition-colors">
                        {r.title || '(untitled)'}
                      </a>
                    </td>
                    <td className="py-3 text-muted capitalize hidden sm:table-cell">{r.channel}</td>
                    <td className="py-3 text-muted hidden md:table-cell">{r.created_by}</td>
                    <td className="py-3 text-right"><StatusChip status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

export default function Dashboard() {
  const user = loadAuth()?.user
  if (!user) return null
  if (user.role !== 'manager' && user.role !== 'admin') {
    return <PersonalDashboard user={user} />
  }
  return <ManagerDashboard />
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'teams', label: 'Teams' },
  { id: 'rules', label: 'Rules' },
  { id: 'sla', label: 'SLA' },
] as const

type Tab = typeof TABS[number]['id']

function ManagerDashboard() {
  const [d, setD] = useState<Analytics | null>(null)
  const [trend, setTrend] = useState<TrendResponse | null>(null)
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [tab, setTab] = useState<Tab>('overview')
  const [err, setErr] = useState('')

  useEffect(() => {
    api<Analytics>('/analytics/summary')
      .then(setD)
      .catch((e) => {
        const m = msg(e)
        setErr(m)
        toast.error('Could not load analytics', { description: m })
      })
  }, [])

  useEffect(() => {
    let active = true
    api<TrendResponse>(`/analytics/trend?days=${days}`)
      .then((res) => { if (active) setTrend(res) })
      .catch(() => { /* chart is supplementary; KPIs still render */ })
    return () => { active = false }
  }, [days])

  if (err) {
    return (
      <div role="alert" className="text-danger text-sm p-4 bg-danger/10 rounded-lg border border-danger/30">
        {err}
      </div>
    )
  }
  if (!d) return <Loading label="Loading compliance analytics" />

  const heatMax = Math.max(...d.heat_map.map((h) => h.count), 1)
  const ruleMax = d.most_violated_rules[0]?.count ?? 1
  const spark = (pick: (p: TrendResponse['points'][number]) => number) =>
    trend?.points.slice(-14).map(pick)

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <span className="eyebrow">Portfolio</span>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight mt-1">
            Compliance dashboard
          </h1>
          <p className="text-sm text-muted mt-1">
            Copy compliance, AI audit logs and SLA monitors across every team.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md
            bg-surface-2 border border-hairline text-xs text-muted">
            <span className="w-2 h-2 rounded-full bg-sage" />
            Live
          </span>
          <div className="seg inline-flex border border-hairline-strong rounded-md overflow-hidden">
            {([7, 30, 90] as const).map((n) => (
              <button key={n} onClick={() => setDays(n)}
                      className={`px-2.5 py-1.5 text-[11px] font-mono cursor-pointer transition-colors ${
                        days === n
                          ? 'bg-accent/15 text-accent'
                          : 'text-muted hover:text-ink hover:bg-surface-2'
                      }`}>
                {n}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <div data-tour="kpi-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Compliance rate" value={`${d.compliance_rate}%`}
             sub={`${d.approved} of ${d.total_content} drafts approved`}
             tone="text-sage" icon={TrendingUp}
             spark={spark((p) => p.compliance_rate)} sparkTone="sage" />
        <Kpi label="Open criticals" value={String(d.findings_by_severity.critical ?? 0)}
             sub="Resolve before publishing"
             tone={d.findings_by_severity.critical ? 'text-danger' : 'text-ink'}
             icon={AlertCircle} spark={spark((p) => p.findings)} sparkTone="danger" />
        <Kpi label="Awaiting review" value={String(d.pending)}
             sub={`${d.overdue_reviews.length} past SLA`}
             tone={d.overdue_reviews.length ? 'text-warn' : 'text-ink'}
             icon={AlertTriangle} spark={spark((p) => p.created)} sparkTone="warn" />
        <Kpi label="LLM compute" value={d.total_tokens.toLocaleString()}
             sub={`${d.llm_calls} automated review passes`}
             tone="text-accent" icon={Cpu} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-hairline overflow-x-auto" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3.5 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap cursor-pointer transition-colors ${
                    tab === t.id
                      ? 'border-accent text-accent'
                      : 'border-transparent text-muted hover:text-ink'
                  }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          <Section tourId="chart-trend" title="Compliance trend"
                   right={<span className="text-[11px] text-faint">last {days} days</span>}>
            {!trend ? (
              <Skeleton className="h-[240px] w-full" />
            ) : (
              <Suspense fallback={<Skeleton className="h-[240px] w-full" />}>
                <TrendChart points={trend.points} />
              </Suspense>
            )}
          </Section>

          <div className="grid lg:grid-cols-2 gap-5">
            <Section tourId="chart-heatmap" title="Guideline-gap heat map"
                     right={<span className="text-[11px] text-faint">category × severity</span>}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="pb-3 text-left font-semibold text-faint uppercase">Category</th>
                      {SEVS.map((s) => (
                        <th key={s} className="pb-3 text-center font-semibold text-muted uppercase tracking-wider">
                          {s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {CATS.map((c) => (
                      <tr key={c}>
                        <td className="pr-3 text-left py-2 font-semibold text-muted uppercase tracking-wider text-[11px]">
                          {c}
                        </td>
                        {SEVS.map((s) => {
                          const cell = d.heat_map.find((h) => h.category === c && h.severity === s)
                          const n = cell?.count ?? 0
                          return (
                            <td key={s} className="p-1">
                              <div className="h-10 flex items-center justify-center rounded-md tabular-nums font-bold border border-hairline"
                                   style={heatStyle(n, heatMax, s)}>
                                {n || '·'}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

<Section tourId="chart-categories" title="Findings by category"
                     right={<span className="text-[11px] text-faint">all time</span>}>
               {d.by_category.length === 0 ? (
                 <Empty>No findings recorded.</Empty>
               ) : (
                 <div className="space-y-3">
                   {d.by_category.map((c, i) => {
                     const max = Math.max(...d.by_category.map((x) => x.count), 1)
                     return (
                       <div key={c.category}
                            className="grid grid-cols-[72px_1fr_40px] items-center gap-3 text-xs">
                         <span className="text-muted capitalize">{c.category}</span>
                         <Bar value={c.count} max={max}
                              tone={i % 2 ? 'accent' : 'ink'} />
                         <span className="tabular-nums text-right text-ink font-semibold">
                           {c.count}
                         </span>
                       </div>
                     )
                   })}
                 </div>
               )}
             </Section>

            {d.guideline_gaps.length > 0 && (
              <Section tourId="guideline-gaps" title="Guideline gaps"
                       right={<span className="text-[11px] text-faint">coverage</span>}>
                <div className="space-y-3">
                  {d.guideline_gaps.map((g) => (
                    <div key={g.category}
                         className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs p-2 rounded-md hover:bg-surface-2 transition-colors">
                      <span className="text-muted capitalize">{g.category}</span>
                      <span className={`${g.missing ? 'text-danger' : 'text-sage'} font-medium text-[10px] shrink-0 uppercase tracking-wider`}
                        title={g.missing ? 'No KB passage found' : 'Covered by KB'}>
                        {g.missing ? 'gap' : 'covered'}
                      </span>
                      <span className="tabular-nums text-right text-ink font-semibold">{g.count}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>
      )}

      {tab === 'teams' && (
        <Section title="Team compliance performance">
          {d.by_team.length === 0 ? (
            <Empty>No content submitted by any team yet.</Empty>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-faint uppercase tracking-wider text-[11px] border-b border-hairline">
                    <th className="pb-2.5 text-left font-semibold">Team</th>
                    <th className="pb-2.5 text-right font-semibold">Content</th>
                    <th className="pb-2.5 text-right font-semibold">Findings</th>
                    <th className="pb-2.5 text-right font-semibold">Criticals</th>
                    <th className="pb-2.5 text-right font-semibold w-32">Compliance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {d.by_team.map((t) => (
                    <tr key={t.team} className="hover:bg-surface-2 transition-colors">
                      <td className="py-3 font-semibold text-ink">{t.team}</td>
                      <td className="py-3 text-right tabular-nums text-muted">{t.total}</td>
                      <td className="py-3 text-right tabular-nums text-muted">{t.findings}</td>
                      <td className="py-3 text-right tabular-nums font-semibold text-danger">
                        {t.criticals || '—'}
                      </td>
                      <td className="py-3 pl-4">
                        <div className="flex items-center gap-2.5">
                          <Bar value={t.compliance_rate} max={100}
                               tone={t.compliance_rate >= 70 ? 'accent' : 'critical'} />
                          <span className="tabular-nums text-xs text-right text-muted w-10 font-medium">
                            {t.compliance_rate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {tab === 'rules' && (
        <Section title="Frequently violated guidelines"
                 right={<span className="text-[11px] text-faint">top {Math.min(d.most_violated_rules.length, 8)}</span>}>
          {d.most_violated_rules.length === 0 ? (
            <Empty>No guideline violations recorded.</Empty>
          ) : (
            <div className="space-y-3">
              {d.most_violated_rules.slice(0, 8).map((r, i) => (
                <div key={r.rule}
                     className="grid grid-cols-[auto_1fr_120px_45px] gap-4 items-center text-xs p-2 rounded-md hover:bg-surface-2 transition-colors">
                  <span className="w-5 text-faint font-mono text-[11px]">{i + 1}.</span>
                  <span className="truncate font-medium text-ink" title={r.rule}>{r.rule}</span>
                  <Bar value={r.count} max={ruleMax} tone="accent" />
                  <span className="tabular-nums text-right font-bold text-accent text-xs">{r.count}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === 'sla' && (
        <div className="grid lg:grid-cols-2 gap-5">
          <Section title="Overdue reviews"
                   right={<Badge className={d.overdue_reviews.length
                     ? 'bg-warn/10 text-warn border-warn/40'
                     : 'text-muted border-hairline-strong'}>
                     {d.overdue_reviews.length} past due
                   </Badge>}>
            {d.overdue_reviews.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-sage p-4 bg-sage/10 rounded-md border border-sage/30">
                <CheckCircle2 className="w-4 h-4" />
                <span>All draft reviews are within SLA windows.</span>
              </div>
            ) : (
              <ul className="divide-y divide-hairline text-xs">
                {d.overdue_reviews.map((o) => (
                  <li key={o.id} className="py-2.5 flex items-center justify-between gap-3 hover:bg-surface-2 px-2 rounded-md transition-colors">
                    <a href={`#/review/${o.id}`}
                       className="flex-1 truncate font-medium text-ink hover:text-accent transition-colors">
                      {o.title}
                    </a>
                    <StatusChip status={o.status} />
                    <span className="tabular-nums text-danger font-semibold text-[11px] shrink-0">
                      {o.hours_late}h overdue
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Fact store verification"
                   right={<span className="text-[11px] text-faint">&gt; 90 days old</span>}>
            {d.stale_facts.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-sage p-4 bg-sage/10 rounded-md border border-sage/30">
                <CheckCircle2 className="w-4 h-4" />
                <span>Fact store claims are fresh and verified.</span>
              </div>
            ) : (
              <ul className="divide-y divide-hairline text-xs">
                {d.stale_facts.map((f) => (
                  <li key={f.id} className="py-3 hover:bg-surface-2 px-2 rounded-md transition-colors">
                    <div className="flex gap-3 items-baseline justify-between">
                      <span className="text-ink font-medium">{f.claim}</span>
                      <span className="tabular-nums text-xs text-warn font-semibold shrink-0">
                        {f.days_old}d old
                      </span>
                    </div>
                    <div className="text-[11px] text-muted mt-1 flex items-center gap-2">
                      <span>Source: {f.source}</span>
                      <span>·</span>
                      <span>Verified: {f.verified_at}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  )
}
