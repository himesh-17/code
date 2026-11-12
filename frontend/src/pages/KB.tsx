import { useCallback, useEffect, useState } from 'react'
import { api, ingestGuidelines, msg, type User } from '../api'
import { ROLE_RANK } from '../App'
import { Badge, Btn, Empty, Field } from '../ui'
import { inputCls } from '../lib/styles'
import { ChevronDown, Download, FileText, Plus, Trash2, X } from 'lucide-react'

type Kind = 'guidelines' | 'glossary' | 'facts' | 'colors'

interface Row { id: number; [k: string]: unknown }

const KINDS: { id: Kind; label: string; fields: string[];
               required: string[]; extra?: string[] }[] = [
  { id: 'guidelines', label: 'Guidelines', fields: ['title', 'body'],
    required: ['title', 'body'] },
  { id: 'glossary', label: 'Glossary & Terms',
    fields: ['term', 'kind', 'note'], required: ['term'] },
  { id: 'facts', label: 'Fact Store', fields: ['claim', 'source'],
    required: ['claim'] },
  { id: 'colors', label: 'Brand Palette', fields: ['hex', 'name'],
    required: ['hex'] },
]

const GLOSSARY_BADGE_STYLE: Record<string, string> = {
  prohibited: 'bg-danger/10 text-danger border-danger/25',
  preferred: 'bg-accent/10 text-accent border-accent/25',
  competitor: 'bg-warn/10 text-warn border-warn/25',
  approved: 'bg-sage/10 text-sage border-sage/25',
}

interface Doc { source: string; chunks: number; ingested_at: string }

export default function KB({ user }: { user: User }) {
  const [kind, setKind] = useState<Kind>('guidelines')
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ingestBusy, setIngestBusy] = useState(false)
  const [ingestErr, setIngestErr] = useState('')
  const [ingestStatus, setIngestStatus] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])

  const canWrite = ROLE_RANK[user.role] >= ROLE_RANK.manager
  const spec = KINDS.find((k) => k.id === kind)!

  const load = useCallback((k: Kind) => {
    api<Row[]>(`/kb/${k}`).then((r) => { setRows(r); setErr('') })
      .catch((e) => setErr(msg(e)))
  }, [])

  const loadDocs = useCallback(() => {
    api<{ documents: Doc[] }>('/kb/documents')
      .then((r) => setDocs(r.documents ?? []))
      .catch(() => setDocs([]))
  }, [])

  const switchKind = (k: Kind) => {
    setKind(k)
    setDraft({})
    setAdding(false)
  }

  useEffect(() => { load(kind) }, [kind, load])

  useEffect(() => { if (canWrite) loadDocs() }, [canWrite, loadDocs])

  async function add() {
    setBusy(true); setErr('')
    try {
      await api(`/kb/${kind}`, { body: draft })
      setDraft({}); setAdding(false)
      load(kind)
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  async function remove(id: number) {
    if (!confirm('Delete this entry? The cryptographic audit log keeps an immutable record.')) return
    setErr('')
    try {
      await api(`/kb/${kind}/${id}`, { method: 'DELETE' })
      load(kind)
    } catch (e) { setErr(msg(e)) }
  }

  async function exportAll() {
    const blob = new Blob([JSON.stringify(
      await api('/kb/export'), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'brandguard-kb-export.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

async function ingestFile() {
    if (!file) return
    setIngestBusy(true); setIngestErr(''); setIngestStatus('')
    try {
      const result = await ingestGuidelines(file)
      setIngestStatus(result.chunks
        ? `Ingested ${result.chunks} chunks from ${result.source ?? file.name}`
        : `No text found in ${result.source ?? file.name}`)
      setFile(null)
      load(kind)
      loadDocs()
    } catch (e) { setIngestErr(msg(e)) } finally { setIngestBusy(false) }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Knowledge Base
          </h1>
          <p className="text-sm text-muted mt-1">
            Governing rules, prohibited terminology, verified factual claims, and color tokens.
          </p>
        </div>
        <div className="flex gap-2.5 items-center">
          <Btn onClick={exportAll}>
            <span className="flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </span>
          </Btn>
{canWrite && (
        <Btn kind="primary" onClick={() => setAdding((a) => !a)}>
          <span className="flex items-center gap-1.5">
            {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{adding ? 'Cancel' : 'Add Entry'}</span>
          </span>
        </Btn>
      )}
        </div>
      </header>

      {/* Living KB v2 — guideline document ingestion (manager+) */}
      {canWrite && (
        <div className="bg-surface-2 border border-hairline rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Living KB v2 — Guideline Document Ingestion
            </h3>
            {docs.length > 0 && (
              <span className="text-[11px] text-faint">
                {docs.reduce((n, d) => n + d.chunks, 0)} passages indexed
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            Upload a brand guideline PDF, DOCX, or TXT — it is chunked,
            embedded, and cited as the source passage in every finding.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="file-input block cursor-pointer bg-surface rounded border border-hairline text-sm px-3 py-2"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <Btn kind="ghost" onClick={ingestFile} disabled={ingestBusy}>
                {ingestBusy ? 'Ingesting…' : 'Ingest Document'}
              </Btn>
            )}
          </div>
          {file && (
            <div className="text-xs text-ink">Selected: {file.name}</div>
          )}
          {ingestErr && (
            <div className="text-xs text-danger">{ingestErr}</div>
          )}
          {ingestStatus && (
            <div className="text-xs text-sage">{ingestStatus}</div>
          )}
          {docs.length > 0 && (
            <ul className="divide-y divide-hairline border-t border-hairline pt-1">
              {docs.map((d) => (
                <li key={d.source}
                    className="flex items-center justify-between gap-3 py-1.5 text-xs">
                  <span className="flex items-center gap-1.5 text-ink min-w-0">
                    <FileText className="w-3.5 h-3.5 text-muted shrink-0" />
                    <span className="truncate">{d.source}</span>
                  </span>
                  <span className="text-muted shrink-0">
                    {d.chunks} chunks · {d.ingested_at}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-hairline gap-2 overflow-x-auto pb-0.5">
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => switchKind(k.id)}
            className={`px-4 py-2.5 text-xs uppercase tracking-wider font-semibold border-b-2 -mb-px transition-all duration-200 cursor-pointer flex items-center gap-2 shrink-0 ${
              kind === k.id
                ? 'border-accent text-accent font-bold bg-accent/5'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <span>{k.label}</span>
            <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-surface-2 border border-hairline">
              {k.id === kind ? rows.length : '·'}
            </span>
          </button>
        ))}
      </div>

      {err && (
        <div className="text-xs text-danger border border-danger/30 bg-danger/10 px-4 py-3 rounded-md">
          {err}
        </div>
      )}

      {/* Add New Entry Drawer */}
      {adding && canWrite && (
        <div className="bg-surface-2 border border-hairline p-5 rounded-lg backdrop-blur-sm space-y-4 shadow-none">
          <div className="flex items-center justify-between pb-2 border-b border-hairline">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
              Create New {spec.label} Entry
            </h3>
            <span className="text-[11px] text-muted">Audited change</span>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {spec.fields.map((f) => (
              <Field key={f} label={f}>
                {f === 'body' ? (
                  <textarea
                    className={`${inputCls} h-24 resize-none`}
                    value={draft[f] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                    placeholder="Enter detailed rule requirements or explanation…"
                  />
                ) : f === 'kind' ? (
                  <div className="relative">
                    <select
                      className="w-full border border-hairline bg-surface-2 text-ink px-3.5 py-2 text-sm rounded-lg focus:border-accent focus:ring-1 focus:ring-accent/40 focus:outline-none transition-all cursor-pointer appearance-none pr-9"
                      style={{ backgroundColor: '#0f1117', color: '#f4f4f5' }}
                      value={draft[f] ?? 'approved'}
                      onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                    >
                      {['approved', 'prohibited', 'preferred', 'competitor'].map((o) => (
                        <option
                          key={o}
                          value={o}
                          className="bg-surface-2 text-ink"
                          style={{ backgroundColor: '#0f1117', color: '#ffffff' }}
                        >
                          {o}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                ) : (
                  <input
                    className={inputCls}
                    value={draft[f] ?? ''}
                    placeholder={f === 'hex' ? '#DB4B16' : `Enter ${f}…`}
                    onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                  />
                )}
              </Field>
            ))}
          </div>
          <Btn kind="primary" onClick={add} disabled={busy}>
            {busy ? 'Saving to Ledger…' : 'Save Entry'}
          </Btn>
        </div>
      )}

      {/* Entries List */}
      <div className="bg-surface border border-hairline rounded-lg divide-y divide-hairline backdrop-blur-sm shadow-none overflow-hidden">
        {rows.length === 0 && (
          <div className="p-8"><Empty>No entries found in this category.</Empty></div>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            className="px-5 py-4 flex items-start justify-between gap-4 group hover:bg-surface-2 transition-colors"
          >
            {kind === 'colors' && (
              <span
                className="w-7 h-7 rounded-lg border border-hairline-strong shrink-0 mt-0.5 shadow-none"
                style={{ background: String(r.hex) }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm break-words leading-relaxed">
                {kind === 'guidelines' ? (
                  <>
                    <strong className="text-ink font-semibold">{String(r.title)}</strong>
                    <span className="text-ink"> — {String(r.body)}</span>
                  </>
                ) : kind === 'glossary' ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-xs font-semibold text-ink bg-surface-3 border border-hairline-strong px-2.5 py-1 rounded-md shadow-none">
                      {String(r.term)}
                    </span>
                    <Badge
                      className={GLOSSARY_BADGE_STYLE[String(r.kind)] ?? 'bg-surface-2 text-muted border-hairline'}
                    >
                      {String(r.kind)}
                    </Badge>
                    {r.note ? (
                      <span className="text-ink text-xs"> — {String(r.note)}</span>
                    ) : null}
                  </div>
                ) : kind === 'facts' ? (
                  <div>
                    <span className="text-ink font-medium">{String(r.claim)}</span>
                    {r.source ? (
                      <span className="text-muted text-xs ml-2">
                        · Source: {String(r.source)}
                      </span>
                    ) : null}
                    {r.verified_at ? (
                      <span className="text-[11px] text-faint ml-2">
                        · Verified: {String(r.verified_at)}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-ink text-xs font-semibold">{String(r.hex)}</span>
                    <span className="text-muted text-xs">· {String(r.name)}</span>
                  </div>
                )}
              </div>
            </div>
            {canWrite && (
              <button
                onClick={() => remove(r.id)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded text-faint hover:text-danger hover:bg-danger/10 transition-all cursor-pointer shrink-0"
                title="Delete entry"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <footer className="text-xs text-faint flex items-center justify-between pt-2">
        <span>Read access granted to all roles; modifications restricted to Manager / Admin roles.</span>
        <span>Cryptographic Audit Trail Active</span>
      </footer>
    </div>
  )
}
