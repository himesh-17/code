# BrandGuard AI

**Brand-compliance review platform** — paste copy, get findings, ship only
what passes.

Content goes in → an AI + deterministic rule engine reviews it against the
living brand knowledge base (guidelines, glossary, fact store, colours) →
ranked findings with fixes and evidence → a human accepts/dismisses each
finding and approves → team-level compliance analytics.

> **AI disclosure:** findings are AI-generated and **advisory** — a human
> always makes the final approval decision. This is enforced in code
> (approval is blocked while critical findings are unresolved), surfaced in
> `/health`, and shown as a banner in the UI.

---

## Table of contents

- [Features](#features)
- [Quickstart](#quickstart)
- [Demo walkthrough](#demo-walkthrough)
- [Demo accounts & roles](#demo-accounts--roles)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Data model](#data-model)
- [Architecture](#architecture)
- [Frontend](#frontend)
- [Testing & quality gates](#testing--quality-gates)
- [Security & production hardening](#security--production-hardening)
- [Governance & audit](#governance--audit)
- [Deploy](#deploy)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Round 3 status](#round-3-status)
- [v1.1 roadmap](#v11-roadmap-deliberately-not-built)

---

## Features

### Review engine
- **One LLM call** (Groq `openai/gpt-oss-120b`, JSON mode) reviews tone,
  terminology and claims together; provider chain **Groq → OpenAI →
  deterministic-only** with automatic fallback.
- **Deterministic checks always run**, LLM or not:
  - glossary regex (prohibited / preferred / approved / competitor terms,
    with exception handling so "not a bank" doesn't false-positive)
  - WCAG contrast math (sRGB luminance, real ratio formula)
  - HTML structure: headings, alt text, "click here"-style links
  - reading level (Flesch–Kincaid, sentence-length guard)
  - regulatory disclaimer presence ("not a bank… Members FDIC")
  - competitor mentions → critical
  - **amounts not backed by the Fact Store** → critical claim
  - brand-colour distance (Pillow dominant-colour extraction)
- **Multimodal creative review** (image content, needs `GEMINI_API_KEY`):
  Gemini reads the creative — OCR text, logo presence, palette clashes —
  and emits region-tagged findings (`Evidence: Vision OCR (Gemini) ·
  region: top-left`); a deterministic Pillow pass measures **pixel WCAG
  contrast** on the headline/footer bands. Text excerpts are grounded in
  the model's own OCR output (fabricated text is dropped, same discipline
  as the text engine). Provider chain walks
  `GEMINI_VISION_MODELS` (default `gemini-3.8-flash,gemini-flash-lite-latest`)
  and degrades to palette-only if every model fails — review never errors.
- **RAG**: BM25 retrieval (stdlib, no vector DB) seeds the prompt with the
  3 most relevant guideline chunks + full glossary + fact store.
- **Evidence on every finding** — `evidence` cites the glossary entry,
  fact, or guideline that justifies it (never the literal string "none").
- **Grounding filter**: an excerpt must plausibly exist in the submitted
  content (verbatim or ≥70% token overlap) or the finding is dropped —
  hallucinations never reach the reviewer.
- **Prompt-injection hardening**: content is wrapped in `<content>`
  delimiters, instructions forbid following embedded commands, and a leak
  filter drops any finding that echoes system-prompt fragments.
- **Prompt-injection test passes live** (golden sample in the benchmark).

### Workflow
- Status machine: `draft → review → (changes | approved)` with peer-review
  threads, version snapshots and unified diffs.
- **Approve is blocked (409)** while any critical finding is
  unresolved (`accepted != 1`) — humans must explicitly accept or dismiss.
- SLA timers: entering review stamps `sla_due_at` (+`SLA_HOURS`, default
  24h); overdue reviews surface on the dashboard with hours-late.
- Comment threads per content item, resolvable.
- Publish dispatches an **HMAC-SHA256 signed webhook** (optional target).
- Image uploads: content-type allowlist, 5MB cap, PIL decode verification,
  UUID filenames (no path traversal), alt text fed into a11y checks.
  Stored as public `/uploads/…` URLs (served by the app, proxied through
  Vercel) and uploadable from the **Upload Creative / Replace Image**
  button on the review page — no API call needed.

### Knowledge base (the brand's source of truth)
- Four live tables, editable at runtime (no redeploys):
  - **Guidelines** — prose rules the engine retrieves via BM25
  - **Glossary** — `approved | prohibited | preferred | competitor` terms
  - **Fact store** — verifiable claims with source + `verified_at`
  - **Colours** — brand palette (`#RRGGBB`) used by visual checks
- Read + JSON export for every role; create/edit/delete and bulk import
  require **manager+**.
- Stale-fact detection: facts verified >90 days ago are flagged on the
  dashboard so legal can re-verify before claims go out.

### Platform
- **Enterprise JWT auth**: bcrypt password hashing, short-lived access tokens
  (60min) + rotating refresh tokens (7 days, old refresh revoked on use),
  **token reuse detection with family invalidation**, and per-token revocation
  on logout.
- **RBAC**: `creator < reviewer < manager < admin`, enforced server-side per route.
- **High-concurrency database**: SQLite in WAL mode (`PRAGMA journal_mode = WAL`,
  `PRAGMA busy_timeout = 5000`) with compound indexes on findings, content,
  refresh tokens, knowledge chunks, and audit logs.
- **Analytics**: compliance rate, category breakdown, most-violated rules,
  severity split, **category × severity heat map**, per-team scores,
  overdue list, stale facts, LLM token spend.
- **Tamper-evident audit log**: every action appends a
  `prev_hash → sha256` chain; `/audit/verify` walks it and reports breaks.
- **Rate limiting**: 10 reviews/min/IP and sliding-window protection on auth endpoints.
- **Hardened headers & tracing**: HSTS, `Permissions-Policy`, `X-Request-ID` correlation
  tracing, sanitized 500s with correlation IDs, `Cache-Control: no-store`.

---

## Quickstart

### Prerequisites
- Python **3.12** (uses [uv](https://docs.astral.sh/uv/) or any venv)
- Node **20+** (pnpm or npm)
- A Groq API key for live LLM reviews (optional — `mock` mode needs none)
- A Google Gemini API key for vision review of image creatives (optional —
  without it, images still get palette + text checks)

### 1. Backend

```bash
# clone + environment
git clone https://github.com/varun-pahuja/code.git && cd code
uv venv --python 3.12
uv pip install -r backend/requirements.txt

# keys live in .env at the repo root (gitignored)
#   LLM_PROVIDER=groq
#   GROQ_API_KEY=...
#   GROQ_MODEL=openai/gpt-oss-120b
#   GEMINI_API_KEY=...        # optional, vision review of images
#   JWT_SECRET=...            # required in prod
#   WEBHOOK_SECRET=...        # optional, signs publish webhooks

cd backend
../.venv/bin/uvicorn app.main:app --port 8001
```

- API + interactive docs: <http://localhost:8001/docs>
- Health (AI/model disclosure): <http://localhost:8001/health>
- First boot auto-creates the SQLite DB, seeds the brand knowledge base,
  sample content and the four demo users.

Run the whole API with **no key** (tests, demos, CI):

```bash
LLM_PROVIDER=mock ../.venv/bin/uvicorn app.main:app --port 8001
```

### 2. Frontend

```bash
cd frontend
pnpm install            # or: npm install
pnpm dev                # http://localhost:5173  (proxies /auth,/content,… → :8001)
```

Production build:

```bash
pnpm build              # → dist/  (53.8 kB JS entry, ~15.6 kB gzip)
pnpm preview            # serves dist/ with the same proxy
```

---

## Demo walkthrough

1. Open <http://localhost:5173> → click **Manager** (one-click demo login).
2. **Dashboard** — compliance rate, open criticals, category × severity
   heat map, team scores, overdue reviews, stale facts, LLM spend.
3. **Review queue → + New** — give it a title, paste some copy
   (try: `Act NOW! Guaranteed returns — better than Zenith Pay. Send $9.99.`).
4. **Run AI review** — findings appear ranked critical → suggestion, each
   with excerpt, fix suggestion, confidence and evidence.
5. Try **Approve** — it's *blocked* while criticals are unresolved.
   Accept or dismiss each critical, then approve.
6. Add a **peer-review comment**, inspect **version history + diff**.
7. **Knowledge base** — edit glossary terms or add a fact; re-run the
   review and the engine picks it up immediately (no restart).

---

## Demo accounts & roles

| Email                    | Password    | Role     | Team      | Can do                                     |
| ------------------------ | ----------- | -------- | --------- | ------------------------------------------ |
| `creator@brandguard.demo`  | `creator123`  | creator  | marketing | create content, run reviews, comment       |
| `reviewer@brandguard.demo` | `reviewer123` | reviewer | marketing | + accept/dismiss findings, approve*        |
| `manager@brandguard.demo`  | `manager123`  | manager  | brand     | + analytics, KB write, request changes     |
| `admin@brandguard.demo`    | `admin12345`  | admin    | brand     | + user management, delete anything, admin ops |

\* approval additionally requires every critical finding resolved.

| Capability                    | creator | reviewer | manager | admin |
| ----------------------------- | :-----: | :------: | :-----: | :---: |
| Create / view content         |   ✅    |    ✅    |   ✅    |  ✅   |
| Run AI review                 |   ✅    |    ✅    |   ✅    |  ✅   |
| Accept / dismiss findings     |   ❌    |    ✅    |   ✅    |  ✅   |
| Approve / request changes     |   ❌    |    ✅    |   ✅    |  ✅   |
| Peer-review comments          |   ✅    |    ✅    |   ✅    |  ✅   |
| Resolve comments              |   ❌    |    ❌    |   ✅    |  ✅   |
| Analytics dashboard           |   ❌    |    ❌    |   ✅    |  ✅   |
| KB create / edit / delete     |   ❌    |    ❌    |   ✅    |  ✅   |
| KB bulk import                |   ❌    |    ❌    |   ✅    |  ✅   |
| KB export (JSON)              |   ✅    |    ✅    |   ✅    |  ✅   |
| Publish (signed webhook)      |   ❌    |    ❌    |   ✅    |  ✅   |
| Create users                  |   ❌    |    ❌    |   ❌    |  ✅   |

---

## Configuration

All config is environment-driven (root `.env` is loaded automatically;
real env vars always win). Nothing sensitive is hardcoded.

| Variable                | Default                                    | Purpose                                        |
| ----------------------- | ------------------------------------------ | ---------------------------------------------- |
| `LLM_PROVIDER`          | `mock`                                     | `groq` \| `openai` \| `mock`                   |
| `GROQ_API_KEY`          | —                                          | Groq key                                       |
| `GROQ_MODEL`            | `openai/gpt-oss-120b`                      | Groq model id                                  |
| `OPENAI_API_KEY`        | —                                          | fallback provider key                          |
| `OPENAI_MODEL`          | `gpt-4o`                                   | fallback model                                 |
| `LLM_TIMEOUT`           | `30.0`                                     | per-request seconds                            |
| `GEMINI_API_KEY`        | — (vision disabled)                        | Gemini key for image vision review             |
| `GEMINI_VISION_MODELS`  | `gemini-3.8-flash,gemini-flash-lite-latest` | comma-separated vision failover chain          |
| `VISION_TIMEOUT`        | `30.0`                                     | per-model vision seconds                       |
| `DATABASE_PATH`         | `data/brandguard.db`                       | SQLite file (use a volume in prod)             |
| `UPLOAD_DIR`            | `data/uploads`                             | image uploads                                  |
| `CORS_ORIGINS`          | `http://localhost:5173,http://localhost:3000` | comma-separated allowlist                  |
| `REVIEW_RATE_PER_MIN`   | `10`                                       | /review rate limit per IP                      |
| `MAX_UPLOAD_BYTES`      | `5242880` (5MB)                            | image size cap                                 |
| `MAX_CONTENT_CHARS`     | `20000`                                    | content truncation bound                       |
| `JWT_SECRET`            | dev fallback (unsafe)                      | **set this in production**                     |
| `ACCESS_TTL_MIN`        | `60`                                       | access token lifetime                          |
| `REFRESH_TTL_DAYS`      | `7`                                        | refresh token lifetime                         |
| `SLA_HOURS`             | `24`                                       | review due window after submit                 |
| `WEBHOOK_URL`           | — (disabled)                               | publish webhook target                         |
| `WEBHOOK_SECRET`        | —                                          | HMAC-SHA256 signing secret                     |
| `INBOUND_ALLOW_AUTOPUBLISH` | `true`                                 | set `0` to block inbound approve/publish (review stays allowed) |

---

## API reference

Base URL: `http://localhost:8001` · interactive docs at `/docs` ·
all request/response bodies are JSON.

Auth: `Authorization: Bearer <access_token>` (except `/auth/login`,
`/auth/refresh`, `/health`).

### Health & auth

| Method | Path             | Auth  | Notes                                            |
| ------ | ---------------- | ----- | ------------------------------------------------ |
| GET    | `/health`        | none  | `{status, product, ai_disclosure, provider, model, llm_available}` |
| POST   | `/auth/login`    | none  | `{email, password}` → `{access_token, refresh_token, token_type, user}` |
| POST   | `/auth/refresh`  | none  | `{refresh_token}` → new pair (old refresh revoked) |
| POST   | `/auth/logout`   | token | revokes the refresh token                        |
| GET    | `/auth/me`       | token | `{id, email, role, team}`                        |
| POST   | `/auth/users`    | admin | create user `{email, password(min 8), role, team}` (201) |

### Content

| Method | Path                        | Auth      | Notes                                        |
| ------ | --------------------------- | --------- | -------------------------------------------- |
| POST   | `/content`                  | token     | `{type, title, text, channel}` → 201; inherits creator's team |
| GET    | `/content`                  | token     | list, optional `?status=draft\|review\|…`     |
| GET    | `/content/{id}`             | token     | content + embedded `findings[]`              |
| PATCH  | `/content/{id}`             | token     | `{title?, text?}` — creates a version snapshot |
| POST   | `/content/{id}/review`      | token     | runs the engine; `?force_mock=true` skips LLM; rate-limited 10/min/IP |
| PATCH  | `/findings/{id}`            | token     | `{accepted: 0\|1\|2}` (pending/accept/dismiss) |
| POST   | `/content/{id}/approve`     | reviewer+ | **409** while any critical finding unresolved |
| POST   | `/content/{id}/request-changes` | reviewer+ | sets status `changes`                     |
| POST   | `/content/{id}/upload`      | token     | multipart `file` + `alt`; image only, 5MB, PIL-verified; stores a public `/uploads/…` URL |
| POST   | `/content/{id}/peer-review` | reviewer+ | `{action: approve\|reject, note?}`           |
| POST   | `/content/{id}/comments`    | token     | `{body, parent_id?}` → 201                   |
| GET    | `/content/{id}/comments`    | token     | thread list                                   |
| PATCH  | `/comments/{id}`            | manager   | `{resolved: bool}`                            |
| GET    | `/content/{id}/versions`    | token     | version snapshots                             |
| GET    | `/content/{id}/diff?frm=1&to=2` | token  | `{lines[], added, removed}` unified diff      |
| POST   | `/content/{id}/publish`     | manager   | HMAC-signed webhook out                       |

### Analytics & audit

| Method | Path                  | Auth    | Notes                                             |
| ------ | --------------------- | ------- | ------------------------------------------------- |
| GET    | `/analytics/summary`  | manager | KPIs, `by_category`, `most_violated_rules`, `findings_by_severity`, `by_team[]`, `heat_map[]` (5×3), `overdue_reviews[]`, `stale_facts[]`, `llm_calls`, `total_tokens` |
| GET    | `/audit`              | token   | audit entries (newest first)                      |
| GET    | `/audit/verify`       | manager | walks the hash chain → `{ok, checked, broken_at}` |

### Knowledge base

| Method | Path                                   | Auth    |
| ------ | -------------------------------------- | ------- |
| GET    | `/kb/guidelines` \| `/kb/glossary` \| `/kb/facts` \| `/kb/colors` | token |
| POST   | same paths                             | manager |
| PATCH  | `/kb/{kind}/{id}`                      | manager |
| DELETE | `/kb/{kind}/{id}`                      | manager |
| GET    | `/kb/export`                           | token   (full JSON dump) |
| POST   | `/kb/import`                           | manager (bulk upsert)    |

### Key payload shapes

**Finding**

```json
{
  "id": 12, "content_id": 3, "category": "term", "severity": "critical",
  "rule": "Prohibited term: \"guaranteed\"",
  "excerpt": "guaranteed returns",
  "suggestion": "Replace with \"designed to\" or remove the claim.",
  "accepted": 0, "confidence": 0.97,
  "evidence": "Brand glossary (prohibited/preferred)"
}
```

- `category`: `tone | term | claim | a11y | visual`
- `severity`: `critical | warning | suggestion`
- `accepted`: `0` pending · `1` accepted · `2` dismissed

**Review result** (POST `/content/{id}/review`)

```json
{
  "findings": [ … ],
  "llm_used": true,
  "latency_ms": 812,
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "tokens": 2957
}
```

**Analytics** (GET `/analytics/summary`, abridged)

```json
{
  "total_content": 12, "approved": 2, "pending": 10,
  "compliance_rate": 16.7, "total_findings": 172,
  "by_category": [{"category": "term", "count": 98, "critical": 50, …}],
  "heat_map": [{"category": "tone", "severity": "critical", "count": 4}, …],
  "by_team": [{"team": "marketing", "total": 8, "compliance_rate": 12.5, …}],
  "overdue_reviews": [{"id": 1, "hours_late": 21, …}],
  "stale_facts": [{"claim": "…", "days_old": 545, …}],
  "llm_calls": 65, "total_tokens": 36679
}
```

---

## Data model

SQLite (WAL) at `DATABASE_PATH`; schema is created idempotently with
column-level migrations for upgrades.

| Table             | Purpose                                                     |
| ----------------- | ----------------------------------------------------------- |
| `content`         | submitted copy: type, title, text, channel, status, team, `sla_due_at`, `published_at`, `image_path` |
| `finding`         | review results: category, severity, rule, excerpt, suggestion, `accepted`, confidence, `evidence` |
| `guideline`       | prose rules (BM25-retrieved into the prompt)                |
| `glossary`        | terms: `kind ∈ approved/prohibited/preferred/competitor`    |
| `fact`            | verifiable claims: claim, source, `verified_at`             |
| `brand_color`     | palette hexes used by visual checks                         |
| `user`            | email, bcrypt hash, role, team, active flag                 |
| `refresh_token`   | jti-granted rotating refresh tokens (revocable)             |
| `comment`         | peer-review threads (parent/child, resolved flag)           |
| `content_version` | text snapshots on every edit → unified diffs                |
| `audit`           | actor, action, detail, tokens, `prev_hash`, `hash` (chain)  |

---

## Architecture

```
                 ┌──────────────────────────────────────────────┐
  content ──────►│  POST /content/{id}/review                   │
                 │                                              │
                 │  1. sanitize (control chars, 20k cap)        │
                 │  2. BM25 retrieval → top-3 guideline chunks  │
                 │  3. LLM call (Groq → OpenAI → none):         │
                 │       system rules + glossary + facts +      │
                 │       <content>untrusted</content>  (JSON)   │
                 │  4. filters: leak → grounding → dedupe       │
                 │       (dedupe keeps highest severity)        │
                 │  5. deterministic tier (always):             │
                 │       terminology · compliance · a11y ·      │
                 │       visual (images)                        │
                 │  6. evidence stamping on every finding       │
                 └──────────────────────────────────────────────┘
                                     │
                                     ▼
        findings stored ──► reviewer accepts/dismisses ──► approve
                              (criticals must clear,       (409s otherwise)
                               audit-logged)                      │
                                                                  ▼
                                              analytics · signed webhook · audit chain
```

### Engine modules (`backend/app/engine/`)

| File            | Responsibility                                                 |
| --------------- | -------------------------------------------------------------- |
| `review.py`     | orchestrator: sanitize → retrieve → LLM → filters → dedupe → evidence |
| `llm.py`        | provider chain, model names, availability                      |
| `retrieval.py`  | tokenizer + BM25 over guideline titles/bodies                  |
| `terminology.py`| glossary regex with word boundaries and exception handling     |
| `compliance.py` | disclaimer, competitor mentions, amounts-vs-fact-store         |
| `a11y.py`       | contrast math, HTML structure, reading level                   |
| `visual.py`     | Pillow dominant colours → brand-palette distance, `resolve_image()` path helper |
| `vision.py`     | Gemini vision: OCR/logo/palette findings, OCR grounding, pixel WCAG bands |
| `mock.py`       | deterministic offline findings (tests, CI, no-key demos)       |

Review orchestration that spans these lives in
`backend/app/review_service.py` (`run_review_on`) — the route and any
future auto re-review both call it.

### Provider fallback
`LLM_PROVIDER=groq` tries Groq, then OpenAI (if keyed), then runs
deterministic checks only — the API never fails closed because a
provider is down. `mock` skips the network entirely.

Vision follows the same rule: `engine/vision.py` walks
`GEMINI_VISION_MODELS` in order (flash tiers intermittently 503 under
demand; the lite tier absorbs the overflow) and returns no findings if
every model fails — palette and text checks still run.

---

## Frontend

Vite + React 19 + TypeScript + Tailwind v4, no UI kit, no chart library,
no icon pack, no webfonts.

### Pages

| Route          | Page            | Highlights                                                    |
| -------------- | --------------- | ------------------------------------------------------------- |
| `#/login`      | Login           | one-click demo accounts, error states                         |
| `#/dashboard`  | Dashboard       | KPI cards (tabular numerals), 5×3 heat map, team table with CSS bars, overdue list, stale facts, most-violated rules, LLM spend |
| `#/review/:id` | Review queue    | list + filters + create form · detail: run review, image upload/replace button, findings with accept/dismiss, approve gate with 409 messaging, peer threads, version diffs |
| `#/kb`         | Knowledge base  | 4 tabs, inline add/delete (manager+), JSON export              |

### Design system — "editorial instrument"

Warm paper, ink, one signal colour. Deliberately **not** the purple-gradient
AI look: hairline borders instead of shadows, system fonts instead of
webfonts, CSS bars instead of a chart lib.

| Token        | Value     | Use                                    |
| ------------ | --------- | -------------------------------------- |
| `--color-paper`     | `#faf9f6` | app background                 |
| `--color-surface`   | `#ffffff` | cards, panels                  |
| `--color-ink`       | `#16130f` | primary text                   |
| `--color-ink2`      | `#6b6560` | secondary text, eyebrows       |
| `--color-hairline`  | `#e7e3dc` | all borders/dividers           |
| `--color-accent`    | `#db4b16` | primary CTAs, active nav      |
| `--color-critical`  | `#be3a1e` | critical severity              |
| `--color-warning`   | `#a16207` | warning severity, SLA          |
| `--color-ok`        | `#15803d` | approved states                |

Severity/status badges, focus rings, `.eyebrow` micro-labels and `.tabular`
numerals live in `src/index.css` + `src/ui.tsx`.

### Scripts

```bash
pnpm dev        # dev server :5173 with API proxy
pnpm build      # tsc + vite build → dist/
pnpm preview    # serve dist/ (same proxy)
node scripts/smoke.mjs   # Playwright end-to-end smoke (needs API + dev server)
```

The smoke script walks the entire product — login → dashboard → create →
live AI review → findings → approve gate → accept criticals → approve →
comment → KB → logout — and fails on any assertion or page error.

### Bundle & Performance

The frontend uses route-level code splitting (`React.lazy` + `Suspense`) and Rollup chunking to achieve an 86% reduction in initial payload:

| Asset                     | Raw      | Gzip    | Notes |
| ------------------------- | -------- | ------- | ----- |
| Main Entry JS             | 53.81 KB | 15.59 KB| Shell, auth store, router |
| CSS                       | 57.58 KB |  9.97 KB| Full design system tokens |
| Vendor React (lazy)       | 212.6 KB | 66.54 KB| React 19 core + DOM |
| Vendor Chart (lazy)       | 199.2 KB | 68.28 KB| Chart.js (loaded only on Analytics) |
| Review Module (lazy)      | 32.53 KB |  7.51 KB| Loaded only in review workspace |
| Dashboard Module (lazy)   | 17.67 KB |  4.67 KB| Loaded only on dashboard |
| Production build time     | —        | ~0.31 s | Vite production compile |

Network calls also benefit from **in-flight GET request deduplication** (`frontend/src/api.ts`), eliminating redundant parallel API calls during view navigation.

---

## Testing & quality gates

```bash
cd backend

# unit + API + workflow tests (mock provider — no API spend, no vision spend)
../.venv/bin/python -m pytest -q                    # 110 tests (100% passing)

# accuracy benchmark against a 12-sample golden set
../.venv/bin/python -m bench.evaluate --mock        # offline gate (CI)
../.venv/bin/python -m bench.evaluate               # live gate (real Groq)

# concurrency load test through the ASGI app (50 parallel requests)
../.venv/bin/python -m bench.load_test --n 50

# frontend lint & strict type-check
npm --prefix ../frontend run lint                   # oxlint: 0 errors, 0 warnings
npm --prefix ../frontend run build                  # tsc -b && vite build
```

**Benchmark gates** (`bench/golden_set.json`):

| Metric                     | Minimum   | Current Result |
| -------------------------- | --------- | -------------- |
| Precision                  | ≥ 0.75    | **1.00** (mock) / **0.83** (live) |
| Recall                     | ≥ 0.80    | **1.00** (mock) / **1.00** (live) |
| Critical catch             | 100%      | **100%**       |
| False criticals on clean copy | 0       | **0 / 3**      |
| Concurrency (n=50)         | 0 errors  | **0 errors** (p50=631ms, p95=1817ms) |

**Current scores** — live Groq: **precision 0.83 · recall 1.00 ·
critical-catch 100% · 0 clean-copy false criticals**. Mock: P=1.00 R=1.00.
Load: 50 concurrent reviews, 0 errors, **p95 397ms** (mock).

Golden set covers: clean copy (must stay silent), banned/preferred terms,
unverified claims, competitor mentions, accessibility failures, missing
disclaimer, unsupported amounts, dense legalese, and a prompt-injection
attempt that tries to hide violations.

CI (`.github/workflows/ci.yml`) runs on every push/PR: install → pip-audit
(informational) → pytest → mock benchmark gate. **No API keys in CI.**

---

## Security & production hardening

- **Auth & Session Security**: bcrypt (cost-graded), HS256 JWT access tokens (60 min),
  rotating refresh tokens (7 days, jti-revoked on use/logout), constant
  -time credential comparison, identical 401 for bad email vs password.
- **Refresh Token Reuse Detection**: replay of an already-revoked refresh token
  triggers an immediate security breach response that **revokes all active
  refresh tokens** for that user family and records a high-priority audit event.
- **Auth Rate Limiting**: sliding-window brute-force protection on `/auth/login` and
  `/auth/refresh` with automatic memory-leak-safe TTL purging of stale IP buckets.
- **Prompt injection**: untrusted content delimited and explicitly
  instructed-as-data; golden-set injection sample passes live; leak filter
  drops findings that echo system-prompt fragments.
- **Hallucination control**: excerpts must be grounded in the content;
  findings are also deduped with severity-aware merge (deterministic
  criticals always win over softer LLM duplicates).
- **Upload Hardening & Decompression Bomb Defense**:
  - Content-type allowlist + 5MB size cap.
  - Image dimension bounds checks (`width <= 8192`, `height <= 8192`, `width * height <= 25,000,000 pixels`) to neutralize pixel-flood memory attacks.
  - Active SVG script inspection (`<script`, `javascript:`, `onload=`, `onerror=`) to block stored XSS.
  - UUID filenames preventing path traversal; public `/uploads/` URLs without filesystem leak.
- **Input Sanitization & Bounds**: Pydantic schema validation with character
  limits across all endpoints (`title <= 500`, `body <= 500,000`, `comment <= 5,000`).
- **Vision**: Gemini sees only the image + brand palette (no other user
  data); the model is instructed to ignore instructions embedded in
  images, and every text excerpt must ground in the model's OCR output.
- **Headers & Tracing**:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (HSTS).
  - `Permissions-Policy: geolocation=(), camera=(), microphone=()`.
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
  - `X-Request-ID` correlation ID tracing across all HTTP requests and error logs.
- **Safe Errors**: global exception handlers return sanitized JSON containing the correlation
  `request_id` with zero stack traces or internal leaks.
- **Database Concurrency**: SQLite configured with `PRAGMA journal_mode = WAL`,
  `PRAGMA synchronous = NORMAL`, and `PRAGMA busy_timeout = 5000` to prevent database
  locks under high parallel load.

---

## Governance & audit

- **Tamper-evident audit log** — every mutating action appends
  `(prev_hash, hash)` where `hash = sha256(prev_hash + row)`. GET
  `/audit/verify` (manager) walks the chain and reports the first break:
  editing or deleting a row out-of-band is detectable.
- **Human-in-the-loop is enforced, not aspirational** — `POST
  /content/{id}/approve` returns **409** while any critical finding has
  `accepted != 1`. The UI mirrors this with a disabled Approve button and
  an explanatory banner. Approval records the actor and timestamp in the
  audit chain.
- **AI disclosure** — `/health` names the active provider/model and states
  findings are advisory; the FastAPI description repeats it; the UI shows
  a persistent banner above every page.
- **SLA** — entering review stamps `sla_due_at = now + SLA_HOURS`;
  overdue items appear on the dashboard with hours-late, sorted worst
  first.
- **Fact freshness** — facts with `verified_at` older than 90 days are
  listed as `stale_facts` so legal can re-verify before those claims
  ship.
- **Reviewer accountability** — accept/dismiss is per-finding, logged,
  and reversible (Undo), so the approval decision is an explicit,
  reconstructible trail rather than a single click.

---

## Deploy

Works on any PaaS that runs a Python HTTP process (Render, Railway, Fly,
Railway, Kubernetes, a plain VM).

### Backend

```bash
# build
pip install -r backend/requirements.txt

# start
uvicorn app.main:app --host 0.0.0.0 --port $PORT

# required env
GROQ_API_KEY=...            LLM_PROVIDER=groq
JWT_SECRET=<long-random>    WEBHOOK_SECRET=<long-random>
CORS_ORIGINS=https://your-frontend.example

# pick ONE database backend:
DATABASE_URL=postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:5432/postgres?sslmode=require
#   ^ Postgres / Supabase (session pooler). Overrides DATABASE_PATH.
DATABASE_PATH=/data/brandguard.db          # SQLite fallback + persistent volume
```

> `DATABASE_URL` wins when set; otherwise the app uses SQLite at
> `DATABASE_PATH`. SQLite needs a **persistent volume** in production. On
> Supabase, the DB persists for free but uploaded images still need a volume
> or object storage. The app is designed for a single instance (in-memory
> rate limiter); run one replica or move the limiter to Redis first.

### Frontend

```bash
pnpm build                  # static files in dist/
# serve dist/ on any static host (Vercel/Netlify/S3/nginx) and proxy
# /auth,/content,/kb,/analytics,/audit,/health to the backend origin —
# or set CORS_ORIGINS to the deployed frontend URL and call it directly.
```

### Post-deploy checklist

- [ ] `JWT_SECRET` and `WEBHOOK_SECRET` set (not the dev fallback)
- [ ] `DATABASE_PATH` on a persistent volume; DB auto-seeds on first boot
- [ ] `CORS_ORIGINS` restricted to the real frontend origin(s)
- [ ] `LLM_PROVIDER=groq` + key present; `/health` shows `llm_available: true`
- [ ] HTTPS terminated at the proxy; `Cache-Control: no-store` intact
- [ ] First login: change demo passwords or delete demo users

---

## Project structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app, routes, middleware, rate limit
│   │   ├── auth.py          # bcrypt, JWT access/refresh, RBAC guards
│   │   ├── db.py            # schema, migrations, hash-chain audit helpers
│   │   ├── seed.py          # guidelines/glossary/facts/colors, demo users
│   │   ├── settings.py      # env-driven config (pydantic-settings)
│   │   ├── models.py        # pydantic contracts (Finding, Analytics, …)
│   │   ├── kb.py            # knowledge-base CRUD + import/export
│   │   ├── workflow.py      # comments, versions, diff, publish, peer review
│   │   ├── review_service.py # shared review runner (route + future re-reviews)
│   │   └── engine/
│   │       ├── review.py    # orchestrator: LLM + filters + dedupe
│   │       ├── llm.py       # Groq → OpenAI → none provider chain
│   │       ├── retrieval.py # BM25 guideline retrieval (stdlib)
│   │       ├── vision.py    # Gemini vision + pixel WCAG (model failover)
│   │       ├── terminology.py / compliance.py / a11y.py / visual.py
│   │       └── mock.py      # offline deterministic findings
│   ├── bench/
│   │   ├── golden_set.json  # 12-sample accuracy corpus
│   │   ├── evaluate.py      # precision/recall/critical-catch gate
│   │   └── load_test.py     # concurrency + p95 budget
│   └── tests/               # 74 tests: api, engine, kb, workflow, ai, vision
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # hash router + shell (rail nav, AI banner)
│   │   ├── api.ts           # typed client, token store, auto-refresh
│   │   ├── ui.tsx           # badges, buttons, bars — the design system
│   │   └── pages/           # Login, Dashboard, Review, KB
│   └── scripts/smoke.mjs    # Playwright end-to-end smoke
├── .github/workflows/ci.yml # pytest + mock benchmark gate
├── data/                    # sqlite db + uploads (gitignored)
├── .env                     # secrets (gitignored)
└── README.md
```

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `llm_available: false` on `/health` | `LLM_PROVIDER=groq` and `GROQ_API_KEY` set? Restart after editing `.env`. |
| Review returns only deterministic findings | Provider chain failed — check the server log (`/tmp/bg_server.log`); deterministic tier still ran, the API stays up. |
| 429 on review | 10/min/IP limit — wait a minute or raise `REVIEW_RATE_PER_MIN`. |
| 403 on `/analytics/summary` | Analytics requires **manager+** — log in as `manager@brandguard.demo`. |
| Approve returns 409 | Unresolved critical findings — accept or dismiss each one first (by design). |
| Tests hit my real database | They don't — `tests/conftest.py` points the app at a temp DB and forces `LLM_PROVIDER=mock` + an empty `GEMINI_API_KEY`. |
| Image has no vision findings | `GEMINI_API_KEY` set on the server? Chain logged a failure? Palette findings still run either way — vision degrades, never errors. |
| Port 8000/5173 busy | Backend: pick another port and keep the frontend proxy in sync (`vite.config.ts`). |
| Frontend "Failed to fetch" | Start the backend first; the dev server proxies to `localhost:8001`. |
| Stale demo data | `rm data/brandguard.db` and restart — schema, seed and demo users recreate on boot. |
| `pkill -f uvicorn` kills my shell | Use `pgrep -f uvicorn \| xargs kill` instead (the pattern matches the command line of the shell itself). |

---

## Round 3 status

The three Round 2 jury commitments, delivered as one-at-a-time slices:

| # | Commitment | Status |
| - | ---------- | ------ |
| 1 | **Multimodal creative review** — vision OCR/logo/palette findings + pixel WCAG, region-anchored evidence, upload UI | ✅ shipped (`68ed785`, live) |
| 2 | **One-click auto-remediation + publishing** — bulk apply with diff preview, auto re-review, Slack/signed webhooks, inbound webhook | ✅ shipped |
| 3 | **Living KB v2** — PDF/DOCX ingestion, chunking, KB citations in findings, guideline-gap analytics | ✅ shipped |

---

## v1.1 roadmap (deliberately not built)

Multi-tenant RBAC, white-label theming, Redis-backed rate limits,
logo/template matching, guideline version UI, DDoS/DR runbooks, multi-LLM
routing policies, SSO, fine-tuned classifier on reviewed history.

---

**Production-hardened enterprise release — backend complete (110 tests, live accuracy P=0.83 / R=1.00, mock P=1.00 / R=1.00, 50-concurrency load PASS), frontend optimized (53.8 KB main bundle, 0 Oxlint warnings, 100% strict TypeScript).**
