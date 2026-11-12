/* Typed API client — token storage, silent refresh-once-on-401. */

export interface User {
  id: number
  email: string
  role: 'creator' | 'reviewer' | 'manager' | 'admin'
  team: string
}

export const ROLE_RANK: Record<User['role'], number> = {
  creator: 0,
  reviewer: 1,
  manager: 2,
  admin: 3,
}

export interface Finding {
  id: number
  content_id: number
  category: 'tone' | 'term' | 'claim' | 'a11y' | 'visual'
  severity: 'critical' | 'warning' | 'suggestion'
  rule: string
  excerpt: string
  suggestion: string
  accepted: 0 | 1 | 2 // 0=pending 1=accepted 2=dismissed
  confidence: number
  evidence: string
}

export interface Content {
  id: number
  type: string
  title: string
  text: string
  channel: string
  status: string
  created_by: string
  team: string
  created_at: string
  updated_at: string
  sla_due_at: string | null
  image_path?: string | null
  findings?: Finding[]
}

export interface RemediateResult {
  applied: number[]
  skipped: number[]
  lines: string[]
  review?: ReviewResult
}

export interface PublishResult {
  content: Content
  webhook: { sent: boolean; status?: number; error?: string; reason?: string }
  slack: { sent: boolean; status?: number; error?: string; reason?: string }
}

export interface ReviewResult {
  findings: Finding[]
  llm_used: boolean
  latency_ms: number
  provider: string
  model: string
  tokens: number
}

export interface TrendPoint {
  date: string
  created: number
  approved: number
  findings: number
  compliance_rate: number
}

export interface TrendResponse {
  days: number
  points: TrendPoint[]
}

export interface Analytics {  total_content: number
  approved: number
  pending: number
  compliance_rate: number
  total_findings: number
  by_category: { category: string; count: number; critical: number
                 warning: number; suggestion: number }[]
  most_violated_rules: { rule: string; count: number }[]
  findings_by_severity: Record<string, number>
  llm_calls: number
  total_tokens: number
  by_team: { team: string; total: number; approved: number; pending: number
             findings: number; criticals: number; compliance_rate: number }[]
  heat_map: { category: string; severity: string; count: number }[]
  overdue_reviews: { id: number; title: string; status: string
                     sla_due_at: string; hours_late: number }[]
  stale_facts: { id: number; claim: string; source: string
                 verified_at: string; days_old: number }[]
  guideline_gaps: { category: string; count: number; missing: boolean }[]
}

const KEY = 'bg.auth'

interface Stored {
  access_token: string
  refresh_token: string
  user: User
}

export function loadAuth(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}

export function saveAuth(s: Stored | null): void {
  if (s) localStorage.setItem(KEY, JSON.stringify(s))
  else localStorage.removeItem(KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, msg: string) {
    super(msg)
    this.status = status
  }
}

/** Error → display string (catch clauses give `unknown`). */
export const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

let refreshInFlight: Promise<boolean> | null = null
const inFlightGet = new Map<string, Promise<unknown>>()

async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const s = loadAuth()
      if (!s) return false
      try {
        const r = await fetch('/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: s.refresh_token }),
        })
        if (!r.ok) return false
        const d = await r.json()
        saveAuth({ ...s, access_token: d.access_token,
                   refresh_token: d.refresh_token })
        return true
      } catch {
        return false
      }
    })().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; retry?: boolean; noDedupe?: boolean } = {},
): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET')
  if (method === 'GET' && !opts.noDedupe && inFlightGet.has(path)) {
    return inFlightGet.get(path) as Promise<T>
  }

  const reqPromise = (async () => {
    const s = loadAuth()
    const headers: Record<string, string> = {}
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (s) headers['Authorization'] = `Bearer ${s.access_token}`

    const r = await fetch(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })

    if (r.status === 401 && s && opts.retry !== false && await tryRefresh()) {
      return api<T>(path, { ...opts, retry: false, noDedupe: true })
    }
    if (!r.ok) {
      let msg = `${r.status}`
      try {
        const d = await r.json()
        msg = d.detail
          ? (typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail))
          : msg
      } catch { /* keep status */ }
      throw new ApiError(r.status, msg)
    }
    if (r.status === 204) return undefined as T
    return r.json() as Promise<T>
  })()

  if (method === 'GET' && !opts.noDedupe) {
    inFlightGet.set(path, reqPromise)
    reqPromise.finally(() => inFlightGet.delete(path))
  }

  return reqPromise
}

/** Multipart upload (image creatives) — same auth + refresh as api(). */
export async function upload<T = unknown>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
  retry = true,
): Promise<T> {
  const s = loadAuth()
  const fd = new FormData()
  fd.append('file', file)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)

  const r = await fetch(path, {
    method: 'POST',
    headers: s ? { Authorization: `Bearer ${s.access_token}` } : undefined,
    body: fd,
  })
  if (r.status === 401 && s && retry && await tryRefresh()) {
    return upload<T>(path, file, fields, false)
  }
  if (!r.ok) {
    let m = `${r.status}`
    try {
      const d = await r.json()
      m = d.detail
        ? (typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail))
        : m
    } catch { /* keep status */ }
    throw new ApiError(r.status, m)
  }
  return r.json() as Promise<T>
}

export type IngestResult = { chunks: number; status: string; source?: string }

/** Ingest a guideline document (PDF/DOCX/TXT) — same auth + refresh as upload(). */
export async function ingestGuidelines(
  file: File, retry = true,
): Promise<IngestResult> {
  const s = loadAuth()
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/kb/ingest', {
    method: 'POST',
    headers: s ? { Authorization: `Bearer ${s.access_token}` } : undefined,
    body: fd,
  })
  if (r.status === 401 && s && retry && await tryRefresh()) {
    return ingestGuidelines(file, false)
  }
  if (!r.ok) {
    let m = `${r.status}`
    try {
      const d = await r.json()
      m = d.detail
        ? (typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail))
        : m
    } catch { /* keep status */ }
    throw new ApiError(r.status, m)
  }
  return r.json() as Promise<IngestResult>
}

export async function login(email: string, password: string): Promise<User> {
  const d = await api<{ access_token: string; refresh_token: string
                        user: User }>('/auth/login', {
    method: 'POST', body: { email, password }, retry: false,
  })
  saveAuth({ access_token: d.access_token,
             refresh_token: d.refresh_token, user: d.user })
  return d.user
}

export function logout(): void {
  const s = loadAuth()
  if (s) {
    api('/auth/logout', { method: 'POST',
                          body: { refresh_token: s.refresh_token },
                          retry: false }).catch(() => {})
  }
  saveAuth(null)
  location.hash = '#/login'
}