import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, msg, upload, type Content, type Finding, type ReviewResult, type User, type RemediateResult, type PublishResult } from '../api'
import { ROLE_RANK } from '../App'
import {
  Badge, Btn, Empty, Field, SeverityBadge, StatusChip,
} from '../ui'
import { inputCls } from '../lib/styles'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  History,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react'

interface Comment {
  id: number; content_id: number; author: string; body: string
  resolved: number; parent_id: number | null; created_at: string
}
interface Version {
  version: number; status: string; created_at: string; author: string
}
interface Diff {
  from: number; to: number; lines: string[]; added: number; removed: number
}

// Resolve/Unresolve forms for reviewers
function ResolveForm({ commentId, cid, setComments }: {
  commentId: number; cid: number; setComments: (c: any[]) => void
}) {
  const [showReply, setShowReply] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const handleResolve = async (withReply = false) => {
    setBusy(true)
    try {
      await api(`/comments/${commentId}`, {
        method: 'PATCH',
        body: { resolved: true, reply: withReply ? reply : '' }
      })
      const fresh = await api<Comment[]>(`/content/${cid}/comments`)
      setComments(fresh)
      setShowReply(false)
      setReply('')
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  if (!showReply) {
    return (
      <button
        className="text-[11px] text-accent hover:text-accent transition-colors cursor-pointer"
        onClick={() => setShowReply(true)}
      >
        Mark resolved
      </button>
    )
  }

  return (
    <div className="flex gap-1 items-center">
      <input
        type="text"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="Reply message (optional)"
        className="text-[11px] px-2 py-1 border border-hairline rounded bg-surface w-48"
      />
      <button
        className="text-[11px] text-sage hover:text-sage cursor-pointer"
        onClick={() => handleResolve(true)}
        disabled={busy}
      >
        {busy ? '...' : 'Resolve & Reply'}
      </button>
      <button
        className="text-[11px] text-sage hover:text-sage cursor-pointer"
        onClick={() => handleResolve(false)}
        disabled={busy}
      >
        Resolve Only
      </button>
      <button
        className="text-[11px] text-faint hover:text-ink cursor-pointer"
        onClick={() => { setShowReply(false); setReply('') }}
      >
        Cancel
      </button>

    </div>
  )
}

function UnresolveForm({ commentId, cid, setComments }: {
  commentId: number; cid: number; setComments: (c: any[]) => void
}) {
  const [showReply, setShowReply] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const handleUnresolve = async (withReply = false) => {
    setBusy(true)
    try {
      await api(`/comments/${commentId}`, {
        method: 'PATCH',
        body: { resolved: false, reply: withReply ? reply : '' }
      })
      const fresh = await api<Comment[]>(`/content/${cid}/comments`)
      setComments(fresh)
      setShowReply(false)
      setReply('')
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  if (!showReply) {
    return (
      <button
        className="text-[11px] text-warn hover:text-warn transition-colors cursor-pointer"
        onClick={() => setShowReply(true)}
      >
        Mark unresolved
      </button>
    )
  }

  return (
    <div className="flex gap-1 items-center">
      <input
        type="text"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="Reply message (optional)"
        className="text-[11px] px-2 py-1 border border-hairline rounded bg-surface w-48"
      />
      <button
        className="text-[11px] text-sage hover:text-sage cursor-pointer"
        onClick={() => handleUnresolve(true)}
        disabled={busy}
      >
        {busy ? '...' : 'Unresolve & Reply'}
      </button>
      <button
        className="text-[11px] text-sage hover:text-sage cursor-pointer"
        onClick={() => handleUnresolve(false)}
        disabled={busy}
      >
        Unresolve Only
      </button>
      <button
        className="text-[11px] text-faint hover:text-ink cursor-pointer"
        onClick={() => { setShowReply(false); setReply('') }}
      >
        Cancel
      </button>
    </div>
  )
}

const SEV_ORDER = { critical: 0, warning: 1, suggestion: 2 }

export default function Review({ selected, user }: { selected: string; user: User }) {
  const rank = ROLE_RANK[user.role]
  const canReview = rank >= ROLE_RANK.reviewer
  const canManage = rank >= ROLE_RANK.manager
  const [list, setList] = useState<Content[]>([])
  const [filter, setFilter] = useState('')
  const [detail, setDetail] = useState<Content | null>(null)
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [diff, setDiff] = useState<Diff | null>(null)
  const [remediatePreview, setRemediatePreview] = useState<RemediateResult | null>(null)
  const [remediateSuccessMsg, setRemediateSuccessMsg] = useState('')
  const [publishStatus, setPublishStatus] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState(
    { title: '', text: '', channel: 'web', type: 'text' })
  const [comment, setComment] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const cid = Number(selected) || 0

  const loadList = useCallback(() => {
    api<Content[]>('/content').then(setList).catch((e) => setErr(msg(e)))
  }, [])

  const loadDetail = useCallback((id: number) => {
    if (!id) return
    api<Content>(`/content/${id}`).then((d) => {
      setDetail(d)
      setResult(null)
      setRemediatePreview(null)
      setRemediateSuccessMsg('')
      setPublishStatus('')
    }).catch((e) => setErr(msg(e)))
    api<Comment[]>(`/content/${id}/comments`).then(setComments)
      .catch(() => setComments([]))
    api<Version[]>(`/content/${id}/versions`).then((v) => {
      setVersions(v)
      if (v.length >= 2) {
        const a = v[v.length - 2].version, b = v[v.length - 1].version
        api<Diff>(`/content/${id}/diff?frm=${a}&to=${b}`).then(setDiff)
          .catch(() => setDiff(null))
      } else setDiff(null)
    }).catch(() => { setVersions([]); setDiff(null) })
  }, [])

  useEffect(loadList, [loadList])
  useEffect(() => {
    if (cid) {
      loadDetail(cid)
    }
  }, [cid, loadDetail])

  const findings: Finding[] = useMemo(() => {
    return (result?.findings ?? detail?.findings ?? [])
      .slice()
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
  }, [result?.findings, detail?.findings])

  const unresolvedCriticals = useMemo(() => {
    return findings.filter((f) => f.severity === 'critical' && f.accepted === 0)
  }, [findings])

  async function create() {
    if (busy) return
    setBusy('create')
    setErr('')
    try {
      const c = await api<Content>('/content', { body: draft })
      setDraft({ title: '', text: '', channel: 'web', type: 'text' })
      setShowCreate(false)
      loadList()
      location.hash = `#/review/${c.id}`
    } catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }

  async function runReview() {
    if (busy) return
    setBusy('review'); setErr('')
    try {
      const r = await api<ReviewResult>(
        `/content/${cid}/review?force_mock=false`, { method: 'POST' })
      setResult(r)
      loadDetail(cid)
      loadList()
    } catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }

  async function uploadImage(file: File) {
    if (busy) return
    if (!file.type.startsWith('image/')) { setErr('File must be an image'); return }
    if (file.size > 5 * 1024 * 1024) { setErr('Image exceeds 5MB limit'); return }
    setBusy('upload'); setErr('')
    try {
      await upload<Content>(`/content/${cid}/upload`, file)
      setResult(null)                  // stale text findings; re-run review
      await Promise.all([loadDetail(cid), loadList()])
    } catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }

  async function setFinding(f: Finding, accepted: 0 | 1 | 2) {
    if (busy) return
    setBusy(`finding-${f.id}`)
    try {
      const updated = await api<Finding>(`/findings/${f.id}`, {
        method: 'PATCH', body: { accepted } })
      const base = result?.findings ?? detail?.findings ?? []
      const next = base.map((x) => (x.id === updated.id ? updated : x))
      if (result) setResult({ ...result, findings: next })
      else setDetail(detail ? { ...detail, findings: next } : detail)
    } catch (e) {
      setErr(msg(e))
    } finally {
      setBusy('')
    }
  }

  const applicableAccepted = findings.filter(
    (f) => f.accepted === 1 && f.excerpt && detail?.text && detail.text.includes(f.excerpt)
  )
  const applicableAcceptedCount = applicableAccepted.length

  async function handlePreviewRemediate() {
    if (!cid || busy) return
    setBusy('remediate')
    setErr('')
    try {
      const res = await api<RemediateResult>(`/content/${cid}/remediate`, {
        method: 'POST',
        body: { apply: false }
      })
      setRemediatePreview(res)
    } catch (e) {
      setErr(msg(e))
    } finally {
      setBusy('')
    }
  }

  async function handleApplyRemediate() {
    if (!cid || busy) return
    const prevCount = findings.length
    setBusy('remediate')
    setErr('')
    try {
      const res = await api<RemediateResult>(`/content/${cid}/remediate`, {
        method: 'POST',
        body: { apply: true }
      })
      setRemediatePreview(null)
      const newCount = res.review?.findings ? res.review.findings.length : 0
      setRemediateSuccessMsg(`Fixes applied · re-review: ${prevCount} → ${newCount} findings`)
      if (res.review) setResult(res.review)
      await Promise.all([loadDetail(cid), loadList()])
    } catch (e) {
      setErr(msg(e))
    } finally {
      setBusy('')
    }
  }

  async function publish() {
    if (!cid || busy) return
    setBusy('publish')
    setErr('')
    try {
      const res = await api<PublishResult>(`/content/${cid}/publish`, { method: 'POST' })
      const wStatus = res.webhook?.sent
        ? `Webhook: sent ${res.webhook.status || 200}`
        : (res.webhook?.reason ? `Webhook: ${res.webhook.reason}` : 'Webhook: not configured')
      const sStatus = res.slack?.sent
        ? 'Slack: sent'
        : (res.slack?.reason ? `Slack: ${res.slack.reason}` : 'Slack: not configured')
      setPublishStatus(`${wStatus} · ${sStatus}`)
      await Promise.all([loadDetail(cid), loadList()])
    } catch (e) {
      setErr(msg(e))
    } finally {
      setBusy('')
    }
  }

  async function approve() {
    if (busy) return
    setBusy('approve'); setErr('')
    try {
      await api(`/content/${cid}/approve`, { method: 'POST' })
      await Promise.all([loadDetail(cid), loadList()])
    } catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }

  async function requestChanges() {
    if (busy) return
    setBusy('rc'); setErr('')
    try {
      await api(`/content/${cid}/request-changes`, { method: 'POST' })
      await Promise.all([loadDetail(cid), loadList()])
    } catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }

  async function postComment() {
    if (busy || !comment.trim()) return
    setBusy('c')
    try {
      await api(`/content/${cid}/comments`, {
        method: 'POST', body: { body: comment.trim() } })
      setComment('')
      setComments(await api<Comment[]>(`/content/${cid}/comments`))
    } catch (e) { setErr(msg(e)) } finally { setBusy('') }
  }

  const visible = useMemo(() => {
    return filter ? list.filter((c) => c.status === filter) : list
  }, [list, filter])

  return (
    <div className="space-y-8 w-full">
      {!cid && (
      <>
      {/* =========================================================================
          SECTION 1: FULL-PAGE REVIEW QUEUE (Top Table View)
      ========================================================================= */}
      <section className="bg-surface border border-hairline rounded-lg backdrop-blur-sm shadow-none overflow-hidden">
        {/* Queue Header & Filters */}
        <div className="p-6 border-b border-hairline flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-ink">Review Queue</h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-surface-2 border border-hairline text-muted font-mono">
                {list.length} Total Drafts
              </span>
            </div>
            <p className="text-xs text-muted mt-1">
              Select any draft to open its compliance evaluation workspace.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Filter Pills */}
            <div className="flex gap-1 bg-surface-2 border border-hairline p-1 rounded-md">
              {['', 'draft', 'review', 'changes', 'approved'].map((s) => (
                <button
                  key={s || 'all'}
                  onClick={() => setFilter(s)}
                  className={`text-[11px] px-3 py-1 rounded-lg uppercase tracking-wider font-semibold transition-all duration-200 cursor-pointer ${
                    filter === s
                      ? 'bg-accent/20 text-accent font-bold border border-accent/40 shadow-[0_0_10px_rgba(249,115,22,0.15)]'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {s || 'all'}
                </button>
              ))}
            </div>

            <Btn kind="primary" onClick={() => setShowCreate((s) => !s)}
                 data-tour="new-submission-btn">
              <span className="flex items-center gap-1.5">
                {showCreate ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{showCreate ? 'Close Form' : 'New Submission'}</span>
              </span>
            </Btn>
          </div>
        </div>

        {/* Expandable New Draft Form */}
        {showCreate && (
          <div data-tour="create-form" className="p-6 border-b border-hairline bg-surface-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                Submit New Copy for Compliance Evaluation
              </h3>
              <span className="text-xs text-faint">Auto-routes to reviewer queue</span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Draft Title">
                <input
                  className={inputCls}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="e.g. Q4 Global Brand Campaign Headline"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Channel">
                  <input
                    className={inputCls}
                    value={draft.channel}
                    onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
                    placeholder="e.g. web, email, social"
                  />
                </Field>
                <Field label="Type">
                  <div className="relative">
                    <select
                      className="w-full border border-hairline bg-surface-2 text-ink px-3.5 py-2 text-sm rounded-lg focus:border-accent focus:ring-1 focus:ring-accent/40 focus:outline-none transition-all cursor-pointer appearance-none pr-9"
                      style={{ backgroundColor: '#0f1117', color: '#f4f4f5' }}
                      value={draft.type}
                      onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                    >
                      <option value="text" className="bg-surface-2 text-ink" style={{ backgroundColor: '#0f1117', color: '#ffffff' }}>text</option>
                      <option value="image" className="bg-surface-2 text-ink" style={{ backgroundColor: '#0f1117', color: '#ffffff' }}>image</option>
                      <option value="email" className="bg-surface-2 text-ink" style={{ backgroundColor: '#0f1117', color: '#ffffff' }}>email</option>
                      <option value="social" className="bg-surface-2 text-ink" style={{ backgroundColor: '#0f1117', color: '#ffffff' }}>social</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Copy Content Body">
                  <textarea
                    className={`${inputCls} h-24 resize-none`}
                    value={draft.text}
                    onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                    placeholder="Paste the marketing copy, claims, or disclaimers to evaluate…"
                  />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Btn onClick={() => setShowCreate(false)}>Cancel</Btn>
              <Btn
                kind="primary"
                onClick={create}
                data-tour="create-open-btn"
                disabled={busy === 'create' || !draft.title || !draft.text}
              >
                {busy === 'create' ? 'Creating…' : 'Create & Open'}
              </Btn>
            </div>
          </div>
        )}

        {/* Full-Width Queue Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-hairline text-muted uppercase tracking-wider text-[11px] bg-surface/40">
                <th className="py-3 px-6 font-semibold">Title & Excerpt</th>
                <th className="py-3 px-4 font-semibold">Channel / Type</th>
                <th className="py-3 px-4 font-semibold">Author & Team</th>
                <th className="py-3 px-4 font-semibold">SLA Deadline</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-6 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-faint">
                    No drafts currently match the filter criteria.
                  </td>
                </tr>
              )}
              {visible.map((c, idx) => {
                const isSelected = cid === c.id
                return (
                  <tr
                    key={c.id}
                    data-tour={idx === 0 ? 'review-queue-row' : undefined}
                    onClick={() => { location.hash = `#/review/${c.id}` }}
                    className={`transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? 'bg-accent/[0.08] shadow-[inset_0_0_0_1px_rgba(249,115,22,0.35)]'
                        : 'hover:bg-surface-2'
                    }`}
                  >
                    <td className="py-4 px-6 max-w-xs sm:max-w-md">
                      <div className="font-semibold text-ink text-sm truncate flex items-center gap-2">
                        <span>{c.title}</span>
                        {isSelected && (
                          <span className="text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded border border-accent/25 font-mono">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-muted text-xs truncate mt-0.5 font-sans">
                        {c.text || '(No text body — image asset)'}
                      </div>
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap">
                      <Badge className="bg-surface-2 text-ink border-hairline">
                        {c.channel} · {c.type}
                      </Badge>
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap text-ink">
                      <div>{c.created_by}</div>
                      <div className="text-[11px] text-faint">team {c.team}</div>
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap">
                      {c.sla_due_at ? (
                        <div className="flex items-center gap-1.5 text-ink">
                          <Clock className={`w-3.5 h-3.5 ${c.status === 'review' ? 'text-warn' : 'text-faint'}`} />
                          <span>
                            {new Date(c.sla_due_at + 'Z').toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            })}
                          </span>
                        </div>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap">
                      <StatusChip status={c.status} />
                    </td>
                    <td className="py-4 px-6 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-xs text-accent group-hover:text-accent font-medium">
                        <span>{isSelected ? 'Viewing' : 'Inspect'}</span>
                        <ArrowDown className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      </>
      )}

      {/* =========================================================================
          SECTION 2: FULL-PAGE EVALUATION WORKSPACE (Bottom Detailed View)
      ========================================================================= */}
      {cid && (
      <div className="space-y-6">
        {detail ? (
          <div className="space-y-6">
            <button
              onClick={() => { location.hash = '#/review' }}
              className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink min-h-10 px-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to queue
            </button>
            {/* Active Draft Action Bar */}
            <div className="bg-surface border border-hairline rounded-lg p-6 backdrop-blur-sm shadow-none">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[11px] font-mono text-accent uppercase tracking-wider bg-accent/10 px-2 py-0.5 rounded border border-accent/25">
                      ACTIVE WORKSPACE
                    </span>
                    <h2 className="text-xl font-bold tracking-tight text-ink">
                      {detail.title}
                    </h2>
                    <StatusChip status={detail.status} />
                    <Badge className="bg-surface-2 text-ink border-hairline">
                      {detail.channel} · {detail.type}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted mt-1.5 flex items-center gap-3">
                    <span>Author: <strong className="text-ink">{detail.created_by}</strong></span>
                    <span>·</span>
                    <span>Team: <strong className="text-ink">{detail.team}</strong></span>
                    {detail.sla_due_at && (
                      <>
                        <span>·</span>
                        <span className="text-warn flex items-center gap-1 font-medium">
                          <Clock className="w-3.5 h-3.5" /> SLA Due: {new Date(detail.sla_due_at + 'Z').toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                  <Btn onClick={runReview} disabled={busy === 'review'} data-tour="run-eval-btn">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                      <span>{busy === 'review' ? 'Evaluating…' : result ? 'Re-run Evaluation' : 'Run AI Evaluation'}</span>
                    </span>
                  </Btn>
                  {canManage && (
                    <div data-tour="manager-actions" className="flex items-center gap-2.5 flex-wrap">
                  <Btn
                    kind="primary"
                    onClick={approve}
                    data-tour="approve-draft-btn"
                    disabled={
                      busy === 'approve' ||
                      detail.status === 'approved' ||
                      detail.status === 'published' ||
                      unresolvedCriticals.length > 0
                    }
                    title={
                      unresolvedCriticals.length
                        ? `${unresolvedCriticals.length} critical finding(s) must be accepted or dismissed first`
                        : ''
                    }
                  >
                    <span className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      <span>{busy === 'approve' ? 'Approving…' : 'Approve Draft'}</span>
                    </span>
                  </Btn>
                  <Btn
                    kind="danger"
                    onClick={requestChanges}
                    disabled={busy === 'rc' || detail.status === 'changes' || detail.status === 'published'}
                  >
                    Request Changes
                  </Btn>
                  {detail.status === 'approved' && (
                    <Btn
                      kind="primary"
                      onClick={publish}
                      disabled={busy === 'publish'}
                      className="!bg-accent hover:!bg-accent/90"
                    >
                      <span className="flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5" />
                        <span>{busy === 'publish' ? 'Publishing…' : 'Publish'}</span>
                      </span>
                    </Btn>
                  )}
                    </div>
                  )}
                </div>
              </div>

              {/* Publish Result Banner */}
              {publishStatus && (
                <div className="mt-4 text-xs text-sage bg-sage/10 border border-sage/30 px-4 py-3 rounded-md flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-sage shrink-0" />
                    <span>{publishStatus}</span>
                  </div>
                  <button onClick={() => setPublishStatus('')} className="text-muted hover:text-ink cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Approval Gating Banner */}
              {unresolvedCriticals.length > 0 && (
                <div className="mt-4 text-xs text-danger bg-danger/10 border border-danger/30 px-4 py-3 rounded-md flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 text-danger shrink-0" />
                  <span>
                    <strong>Approval Blocked</strong> — {unresolvedCriticals.length} critical finding{unresolvedCriticals.length > 1 ? 's' : ''} require action (accept or dismiss each in the findings deck below) before this draft can ship.
                  </span>
                </div>
              )}

              {/* AI Diagnostic Metrics */}
              {result && (
                <div className="mt-4 pt-4 border-t border-hairline flex items-center gap-6 text-xs text-muted flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-accent" />
                    Provider: <strong className="text-ink">{result.provider}</strong>
                  </span>
                  <span>Model: <strong className="text-ink">{result.model}</strong></span>
                  <span className="tabular-nums">Latency: <strong className="text-ink">{result.latency_ms}ms</strong></span>
                  <span className="tabular-nums">Tokens: <strong className="text-ink">{result.tokens}</strong></span>
                  <span>Findings Identified: <strong className="text-ink">{result.findings.length}</strong></span>
                </div>
              )}
            </div>

            {/* Error Toast */}
            {err && (
              <div className="text-xs text-danger border border-danger/30 bg-danger/10 px-4 py-3 rounded-md flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-danger shrink-0" />
                <span>{err}</span>
              </div>
            )}

            {/* Workspace Grid: Draft Content (Left) & Generated Summary / Findings (Right) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Draft Content & Revisions Diff */}
              <div className="lg:col-span-5 space-y-6">
                {/* Content Under Review */}
                <section className="bg-surface border border-hairline rounded-lg overflow-hidden backdrop-blur-sm shadow-none">
                  <header className="px-5 py-3.5 border-b border-hairline flex items-center justify-between bg-surface/40">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                      Content Under Review
                    </h3>
                    <span className="text-[11px] text-faint font-mono">
                      {detail.text.length} chars
                    </span>
                  </header>
                  {detail.status === 'changes' && user.email === detail.created_by && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault()
                        const form = e.currentTarget
                        const fd = new FormData(form)
                        const text = fd.get('text') as string
                        const title = fd.get('title') as string
                        setBusy('edit')
                        try {
                          await api(`/content/${cid}`, {
                            method: 'PATCH',
                            body: { title, text }
                          })
                          await loadDetail(cid)
                        } catch (e) {
                          setErr(msg(e))
                        } finally {
                          setBusy('')
                        }
                      }}
                      className="p-5 space-y-4"
                    >
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">Title</label>
                        <input
                          name="title"
                          defaultValue={detail.title}
                          className={inputCls}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">Text Content</label>
                        <textarea
                          name="text"
                          defaultValue={detail.text}
                          className={inputCls}
                          rows={12}
                          required
                        />
                      </div>
                      <div className="flex gap-2">
                        <Btn type="submit" disabled={busy === 'edit'}>
                          {busy === 'edit' ? 'Saving…' : 'Save Changes'}
                        </Btn>
                        <button
                          type="button"
                          onClick={() => loadDetail(cid)}
                          className="px-3 py-1.5 text-xs text-muted hover:text-ink border border-hairline rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                  {(detail.status !== 'changes' || user.email !== detail.created_by) && (
                    <>
                      <pre className="p-5 text-sm leading-relaxed whitespace-pre-wrap font-sans text-ink bg-surface/70">
                        {detail.text || <span className="text-faint italic">(Empty text content — visual asset draft)</span>}
                      </pre>
                      <div className="p-5 border-t border-hairline space-y-3">
                        {detail.image_path && (
                          <img
                            src={detail.image_path}
                            alt=""
                            className="max-h-60 rounded-md border border-hairline"
                          />
                        )}
                        <div className="flex items-center gap-3 flex-wrap">
                          <input
                            ref={fileRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0]
                              if (f) uploadImage(f)
                              e.target.value = ''
                            }}
                          />
                          <Btn
                            onClick={() => fileRef.current?.click()}
                            disabled={busy === 'upload'}
                          >
                            {busy === 'upload'
                              ? 'Uploading…'
                              : detail.image_path
                                ? 'Replace Image'
                                : 'Upload Creative'}
                          </Btn>
                          <span className="text-xs text-faint">
                            PNG/JPG/WEBP · 5MB max · then Run AI Evaluation
                            for vision + palette findings
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </section>

                {/* Revision Timeline & Diff */}
                {versions.length > 0 && (
                  <section className="bg-surface border border-hairline rounded-lg overflow-hidden backdrop-blur-sm shadow-none">
                    <header className="px-5 py-3.5 border-b border-hairline flex justify-between items-center bg-surface/40">
                      <div className="flex items-center gap-2">
                        <History className="w-3.5 h-3.5 text-muted" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                          Revisions Timeline
                        </h3>
                      </div>
                      <span className="text-xs text-faint">
                        {versions.length} version{versions.length > 1 ? 's' : ''}
                      </span>
                    </header>
                    <div className="p-5 space-y-3">
                      <div className="flex gap-2 flex-wrap text-xs">
                        {versions.map((v) => (
                          <Badge
                            key={v.version}
                            className="bg-surface-2 text-ink border-hairline"
                          >
                            v{v.version} · {v.status}
                          </Badge>
                        ))}
                      </div>

                      {diff && (
                        <details className="mt-3 group" open={diff.added + diff.removed > 0}>
                          <summary className="text-xs font-semibold uppercase tracking-wider text-accent cursor-pointer hover:text-accent flex items-center gap-2 select-none">
                            <span>Revisions Diff (+{diff.added} / −{diff.removed})</span>
                          </summary>
                          <pre className="mt-2.5 font-mono text-xs bg-surface/90 border border-hairline rounded-md p-4 overflow-x-auto leading-relaxed">
                            {diff.lines.map((l, i) => (
                              <div
                                key={i}
                                className={
                                  l.startsWith('+')
                                    ? 'text-sage bg-sage/10 px-1 rounded'
                                    : l.startsWith('-')
                                    ? 'text-danger bg-danger/10 px-1 rounded'
                                    : 'text-faint'
                                }
                              >
                                {l}
                              </div>
                            ))}
                          </pre>
                        </details>
                      )}
                    </div>
                  </section>
                )}

                {/* Peer Reviewer Thread (moved after Revision Timeline) */}
                <section className="bg-surface border border-hairline rounded-lg overflow-hidden backdrop-blur-sm shadow-none">
                  <header className="px-5 py-3.5 border-b border-hairline flex items-center justify-between bg-surface/40">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-3.5 h-3.5 text-muted" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                        Peer Reviewer Thread
                      </h3>
                    </div>
                    <span className="text-xs text-faint">{comments.length} notes</span>
                  </header>
                  <div className="p-5 space-y-4">
                    {comments.length === 0 && (
                      <p className="text-xs text-faint">No reviewer notes posted yet on this draft.</p>
                    )}
                    {comments.map((c) => (
                      <div
                        key={c.id}
                        className={`p-3.5 rounded-md bg-surface-2 border border-hairline text-xs ${
                          c.resolved ? 'opacity-40' : ''
                        }`}
                      >
                        <div className="flex gap-2 items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <strong className="text-ink">{c.author}</strong>
                            <span className="text-[11px] text-faint">
                              {new Date(c.created_at + 'Z').toLocaleDateString(undefined, {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                              })}
                            </span>
                          </div>
                          {user.role === 'reviewer' && !c.resolved ? (
                            <ResolveForm commentId={c.id} cid={cid} setComments={setComments} />
                          ) : user.role === 'reviewer' && c.resolved ? (
                            <UnresolveForm commentId={c.id} cid={cid} setComments={setComments} />
                          ) : (
                            <span className="text-[11px] text-faint flex items-center gap-1">
                              {c.resolved ? (
                                <>
                                  <Check className="w-3 h-3" /> Resolved
                                </>
                              ) : (
                                'Read only'
                              )}
                            </span>
                          )}
                        </div>
                        <div className="text-ink leading-relaxed">{c.body}</div>
                        {/* Show replies */}
                        {comments.filter(r => r.parent_id === c.id).map((r) => (
                          <div key={r.id} className="mt-2 ml-4 pl-3 border-l-2 border-hairline text-xs text-faint">
                            <div className="flex items-center gap-1 mb-0.5">
                              <strong className="text-ink">{r.author}</strong>
                              <span className="text-[10px]">
                                {new Date(r.created_at + 'Z').toLocaleDateString(undefined, {
                                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                })}
                              </span>
                            </div>
                            <div className="text-ink">{r.body}</div>
                          </div>
                        ))}
                      </div>
                    ))}

                    {/* New Note Form */}
                    <div className="flex gap-2.5 pt-2">
                      <input
                        className={inputCls}
                        value={comment}
                        placeholder="Add a review note or compliance feedback…"
                        onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && postComment()}
                      />
                      <Btn onClick={postComment} disabled={busy === 'c' || !comment.trim()}>
                        <span className="flex items-center gap-1.5">
                          <Send className="w-3.5 h-3.5" />
                          <span>Post</span>
                        </span>
                      </Btn>
                    </div>
                  </div>
                </section>
              </div>

              {/* Right Column: Generated Findings Deck */}
              <div className="lg:col-span-7 space-y-6">
                {/* Findings Deck (Generated Evaluation Summary) */}
                <section data-tour="findings-list" className="bg-surface border border-hairline rounded-lg overflow-hidden backdrop-blur-sm shadow-none">
                  <header className="px-5 py-3.5 border-b border-hairline flex justify-between items-center bg-surface/40 flex-wrap gap-2">
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                        Generated Evaluation Summary & Findings
                      </h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-muted border border-hairline font-mono">
                        {findings.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted">
                        {findings.filter((f) => f.accepted === 1).length} accepted · {findings.filter((f) => f.accepted === 2).length} dismissed
                      </span>
                      {canReview && (
                        <Btn
                          onClick={handlePreviewRemediate}
                          disabled={
                            busy === 'remediate' ||
                            applicableAcceptedCount === 0 ||
                            detail?.status === 'approved' ||
                            detail?.status === 'published'
                          }
                          className="!py-1 !px-2.5 !text-xs !bg-accent hover:!bg-accent/90 text-white font-medium shadow-none cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>
                              {busy === 'remediate'
                                ? 'Applying…'
                                : `Apply ${applicableAcceptedCount} accepted fix${applicableAcceptedCount === 1 ? '' : 'es'}`}
                            </span>
                          </span>
                        </Btn>
                      )}
                    </div>
                  </header>

                  {remediateSuccessMsg && (
                    <div className="px-5 py-2.5 bg-sage/10 border-b border-sage/20 text-xs text-sage flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-sage shrink-0" />
                        <span>{remediateSuccessMsg}</span>
                      </div>
                      <button onClick={() => setRemediateSuccessMsg('')} className="text-muted hover:text-ink cursor-pointer">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {findings.length === 0 && (
                    <div className="p-8">
                      <Empty>
                        <p className="text-ink font-medium">No findings recorded yet.</p>
                        <p className="text-xs text-faint mt-1">
                          Click "Run AI Evaluation" above to audit copy against brand guidelines, prohibited terminology, and facts.
                        </p>
                      </Empty>
                    </div>
                  )}

                  <ul className="divide-y divide-hairline">
                    {findings.map((f, idx) => (
                      <li
                        key={f.id}
                        data-tour={idx === 0 ? 'finding-first' : undefined}
                        className={`p-5 transition-opacity ${f.accepted === 2 ? 'opacity-40' : ''}`}
                      >
                        <div className="flex flex-col sm:flex-row items-start gap-4">
                          <SeverityBadge severity={f.severity} />
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="text-sm font-semibold text-ink">
                              {f.rule}
                            </div>
                            {f.excerpt && (
                              <code className="font-mono text-xs bg-surface-2 border border-hairline text-accent px-2.5 py-1 rounded-md inline-block break-all">
                                "{f.excerpt}"
                              </code>
                            )}
                            <div className="text-xs text-ink leading-relaxed">
                              {f.suggestion}
                            </div>
                            <div className="text-[11px] text-faint flex gap-3 flex-wrap pt-1">
                              <span className="capitalize">Category: {f.category}</span>
                              <span>·</span>
                              <span>Confidence: {Math.round(f.confidence * 100)}%</span>
                              <span>·</span>
                              <span className="truncate max-w-md" title={f.evidence}>
                                Evidence: {f.evidence || '—'}
                              </span>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          {canReview && (
                          <div className="flex gap-2 shrink-0 self-end sm:self-start">
                            {f.accepted !== 1 && (
                              <Btn
                                kind="ghost"
                                onClick={() => setFinding(f, 1)}
                                className="!py-1 !px-2.5 !text-xs !border-sage/30 hover:!bg-sage/10 text-sage"
                              >
                                <Check className="w-3.5 h-3.5 inline mr-1" />
                                Accept
                              </Btn>
                            )}
                            {f.accepted !== 2 && (
                              <Btn
                                kind="danger"
                                onClick={() => setFinding(f, 2)}
                                className="!py-1 !px-2.5 !text-xs"
                              >
                                <X className="w-3.5 h-3.5 inline mr-1" />
                                Dismiss
                              </Btn>
                            )}
                            {f.accepted !== 0 && (
                              <Btn
                                onClick={() => setFinding(f, 0)}
                                className="!py-1 !px-2.5 !text-xs"
                              >
                                <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
                                Undo
                              </Btn>
                            )}
                          </div>
                          )}
                        </div>
                        {f.accepted === 1 && (
                          <div className="text-xs text-sage mt-2.5 flex items-center gap-1.5 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Accepted — counts towards compliance threshold.</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      )}
      {/* Remediation Diff Modal */}
      {remediatePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-surface border border-hairline rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <header className="px-5 py-4 border-b border-hairline flex items-center justify-between bg-surface-2">
              <div>
                <h3 className="text-sm font-bold text-ink">Remediation Preview</h3>
                <p className="text-xs text-muted mt-0.5">
                  Review proposed before/after diff for accepted fixes
                </p>
              </div>
              <button
                onClick={() => setRemediatePreview(null)}
                disabled={busy === 'remediate'}
                className="text-muted hover:text-ink transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="flex items-center gap-3 text-xs">
                <span className="px-2.5 py-1 rounded bg-sage/15 text-sage font-medium border border-sage/30">
                  {remediatePreview.applied.length} applied fix{remediatePreview.applied.length === 1 ? '' : 'es'}
                </span>
                {remediatePreview.skipped.length > 0 && (
                  <span className="px-2.5 py-1 rounded bg-surface-2 text-muted font-medium border border-hairline">
                    {remediatePreview.skipped.length} skipped (no exact text match)
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Unified Diff
                </div>
                <pre className="font-mono text-xs bg-surface/90 border border-hairline rounded-md p-4 overflow-x-auto leading-relaxed max-h-80">
                  {remediatePreview.lines.map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.startsWith('+')
                          ? 'text-sage bg-sage/10 px-1 rounded'
                          : l.startsWith('-')
                          ? 'text-danger bg-danger/10 px-1 rounded'
                          : 'text-faint'
                      }
                    >
                      {l}
                    </div>
                  ))}
                </pre>
              </div>
            </div>

            <footer className="px-5 py-3.5 border-t border-hairline flex items-center justify-end gap-2.5 bg-surface-2">
              <Btn
                onClick={() => setRemediatePreview(null)}
                disabled={busy === 'remediate'}
              >
                Cancel
              </Btn>
              <Btn
                kind="primary"
                onClick={handleApplyRemediate}
                disabled={busy === 'remediate'}
              >
                {busy === 'remediate' ? 'Applying…' : 'Confirm & Apply'}
              </Btn>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
