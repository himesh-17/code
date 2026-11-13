# BrandGuard AI — Production Readiness

Round 3 · CodeNexus India 2026 · Team Caelestials

Single source of truth for what was hardened, how it was verified, what remains,
and the exact environment checklist for deployment.

---

## 1. Verification evidence (current tree)

| Gate | Command | Result |
| --- | --- | --- |
| Backend tests | `LLM_PROVIDER=mock .venv/bin/python -m pytest backend/tests/ -q` | **121 passed** |
| Accuracy gate | `cd backend && LLM_PROVIDER=mock ../.venv/bin/python -m bench.evaluate --mock` | PASS |
| Concurrency | `cd backend && LLM_PROVIDER=mock ../.venv/bin/python -m bench.load_test --n 50` | **0 errors, p50 836 ms, p95 2024 ms** |
| Frontend build | `cd frontend && pnpm build` | clean, ~200–400 ms |
| Frontend lint | `cd frontend && pnpm lint` | **0 errors, 0 warnings** |
| Bundle | build output | entry **53.78 kB / 15.58 kB gzip**; vendor-react 212.6 kB, vendor-chart 199.2 kB (both lazy) |
| Live backend | `GET https://branguard-ai-sg.onrender.com/health` | 200, provider `groq`, HSTS + Permissions-Policy + X-Request-ID present |

---

## 2. What changed

### Reviewed & kept: merged PR #7
Route-level `React.lazy` + `Suspense` skeletons, Rollup vendor chunks, HSTS +
`Permissions-Policy`, `X-Request-ID` correlation, SQLite WAL/busy_timeout,
compound indexes, payload `max_length`s, auth sliding-window limiter, refresh
token reuse detection (family revoke), upload dimension caps, in-flight GET
dedupe, double-submit guards, `lib/styles.ts` split, KB tab-state fix, oxlint
clean-up. Verified safe against the full suite.

### Batch 1 — config & availability
- Demo seeding gated by `SEED_DEMO` (default on; `0` = clean prod).
- Prod misconfiguration is loud: `DATABASE_URL`/`JWT_SECRET` problems log
  CRITICAL and surface in `/health` (`database`, `jwt_secret_set`);
  `STRICT_CONFIG=1` upgrades to a hard startup failure.
- Review no longer holds a pooled DB connection across the LLM/vision chain
  (pool starvation + SQLite lock removed).
- Inbound webhook and KB ingest run in the threadpool — no event-loop freeze.
- Review has a wall-clock budget (`REVIEW_BUDGET_SEC`, default 60 s); vision
  and citations are skipped rather than letting the tail run to ~3 minutes.
- Review queue rows are keyboard-accessible (real link in the action cell).

### Batch 2 — security
- Creators can only read their own or their team's content (`GET /content`,
  `GET /content/{id}`, comments, versions); review chain unchanged.
- Uploads rejected on approved/published content (no swapping a signed-off asset).
- User deletion clears `refresh_token` first (no more FK 500).
- Prompt-injection hardening: closing tags defanged in content, guidelines,
  glossary and facts; system prompt declares all reference blocks as data.
- Bounds: `GET /content` limit 1–500 (default 200), `/audit` limit 1–1000,
  `text` capped by `MAX_CONTENT_CHARS` on create and edit.
- Audit coverage extended: login, logout, user create / role change / delete,
  upload.
- Audit hash-chain appends are serialized (Postgres advisory lock / SQLite
  `BEGIN IMMEDIATE`) — concurrent writes previously linked to the same
  predecessor and forked the chain; `backend/tests/test_audit_chain.py` covers
  96 concurrent appends, `backend/scripts/repair_audit_chain.py` relinks an
  existing fork (`--apply`).
- Auth limiter lowered to 60/min and keyed on the real client IP
  (`X-Forwarded-For` first hop) instead of the Render proxy IP.

### Batch 3 — performance
- Vision payloads downscaled to ≤1280 px and JPEG-encoded (multi-MB → hundreds of KB).
- One shared embedding client instead of a new TLS client per call.

### Batch 4 — frontend reliability / UX
- Draft workspace shows a real error + Retry instead of rendering nothing.
- `--color-faint` raised to `#847d8d` (WCAG AA ≥ 4.5:1 on surface).
- Admin users table scrolls horizontally instead of clipping on mobile.
- Guided tour is `role="dialog" aria-modal` and closes on Escape.

### Batch 5 — ops
- `render.yaml` blueprint: health check, env vars, `SEED_DEMO=1`,
  `INBOUND_ALLOW_AUTOPUBLISH=0`, optional disk block (free tier has none).
- Root logging configured (INFO, timestamped, logger names).
- CI now runs a frontend job (pnpm install → lint → type-check + build).
- Postgres gets idempotent `ADD COLUMN IF NOT EXISTS` migrations at boot.
- Legacy `verified_at` backfill only runs in demo mode (never fabricates dates
  for a real deployment).
- `README.md` and `backend/.env.example` updated (test count, hardening, `SEED_DEMO`).

---

## 3. Accepted trade-offs (deliberate)

| Item | Decision | Why |
| --- | --- | --- |
| `STRICT_CONFIG` defaults off | Loud log + `/health` flags; opt-in hard fail | A hard fail could brick the live demo if a Render var is missing. Flip `STRICT_CONFIG=1` after confirming `/health`. |
| Uploads on ephemeral disk | Mirrored to Supabase Storage | Render free has no persistent disks; `SUPABASE_*` env vars mirror every upload to a public bucket and serve it back when the local copy is gone. Without the vars the app behaves exactly as before (local only). |
| `/uploads` served without auth | Accepted | `<img src>` cannot send a bearer token; creatives are demo assets. |
| In-memory rate limiter | Per-process | Single Render instance; multi-worker would need Redis. |
| No login lockout / MFA | Out of scope | Rate limit + short token TTL is proportionate for the demo. |
| No WebSocket live updates | REST polling kept | Judges reload; no operational benefit on free tier. |
| Region not migrated | Current US/Singapore service kept | The submitted Vercel URL proxies to the Render origin; migrating changes the hostname and requires a Vercel redeploy. Do it after submission. |

---

## 4. Environment checklist

### Render (backend)
- [ ] `DATABASE_URL` — Supabase **pooler** URL (`postgres://…`).
- [ ] `JWT_SECRET` — long random value (must **not** be the dev fallback).
- [ ] `LLM_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_MODEL=openai/gpt-oss-120b`.
- [ ] `GEMINI_API_KEY` (vision + embeddings; local fallback if absent).
- [ ] `SEED_DEMO=1` — keeps the four demo accounts judges use.
- [ ] `INBOUND_ALLOW_AUTOPUBLISH=0` — humans approve/publish.
- [ ] `WEBHOOK_SECRET` — any random value (inbound webhook disabled otherwise).
- [ ] `CORS_ORIGINS=https://ai-brandguard.vercel.app` (the Vercel proxy makes
      calls same-origin, but keep this set for direct API use).
- [ ] Health check path `/health`; auto-deploy from `main`.

### Vercel (frontend)
- [ ] `frontend/vercel.json` rewrites point at the Render origin
      (`https://branguard-ai-sg.onrender.com`). Only change if the backend host changes.
- [ ] Production URL `https://ai-brandguard.vercel.app` (submitted — do not change).

### Supabase
- [ ] Postgres project healthy; pooler connection string used.
- [ ] Region: closest available to users (Singapore `ap-southeast-1` recommended).
- [ ] Storage bucket `uploads` created — public, 5 MB limit, image MIME types only.
- [ ] `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `SUPABASE_BUCKET` set on the
      live Render service (`branguard-ai-sg`); the old `branguard-ai` service
      is suspended and needs no vars.

---

## 5. Deploy order (safe)

1. Confirm the Render env vars above **before** pushing — the new code logs
   config problems but still needs the values.
2. `git add -A && git commit && git push` (Render auto-deploys).
3. `GET /health` → expect `"database": "postgres"`, `"jwt_secret_set": true`,
   `"status": "ok"`.
4. If either flag is wrong, fix the Render env var and redeploy **before**
   setting `STRICT_CONFIG=1`.
5. Smoke test: login as each demo role → create → run review → accept criticals
   → approve → publish → audit verify.
6. Optional keep-alive: UptimeRobot (free) pinging `/health` every 10 minutes
   to avoid free-tier cold starts.

---

## 6. Post-submission backlog

- ~~Repair the live audit chain~~ **done** — `python backend/scripts/repair_audit_chain.py
  --apply` run with the live `DATABASE_URL` (the earlier run without
  `DATABASE_URL` had silently repaired the local SQLite copy, not Postgres).
  Live check now returns `{"ok": true, "checked": 216, "broken_at": null}`.
  The append race itself was fixed earlier in `backend/app/db.py`.
  does not affect the judge demo; the fix prevents new forks.
- Migrate backend to Singapore: **done** — blue-green with the Render Blueprint
  (`region: singapore`) → `branguard-ai-sg.onrender.com` → `vercel.json`
  rewrites repointed → Vercel redeployed → old `branguard-ai` suspended.
  Same Supabase project (`ap-southeast-1`), so no data copy was needed.
  Measured: DB-only endpoint 0.65 s (Singapore) vs 0.81 s (Oregon).
- Persistent uploads: **done** — Supabase Storage mirror (free tier) behind the
  `SUPABASE_*` env vars; the Render disk block in `render.yaml` stays commented.
- Login lockout + optional MFA; move rate limiting to Redis if scaling.
- Frontend test framework (Playwright smoke) + CI job.
- Pagination on content/audit lists in the UI.
- Audit-chain external anchoring (periodic hash publication).
