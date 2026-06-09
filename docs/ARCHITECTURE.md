# Architecture — Escape Hatch Search

**Last reviewed: 2026-06-09**

## Purpose

AI-powered semantic search over 300+ episodes of the Escape Hatch Podcast.
Users ask natural-language questions and receive synthesised, cited answers
drawn from episode transcripts and structured metadata.

The app is a **fork of `jbennygold/transcript-app`**. Do not push directly
to `main`/`master`; open a PR to the upstream.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v3 |
| AI — classification & synthesis | Anthropic Claude (Haiku for fast paths / Sonnet for deep synthesis) |
| AI — embeddings | OpenAI `text-embedding-3-small` |
| Search | BM25 lexical index + vector similarity + Reciprocal Rank Fusion |
| Transcription | AssemblyAI (Universal-3 Pro) |
| Storage | Vercel Blob (search indices, transcripts, jobs, logs) |
| Metadata enrichment | TMDB (film/director/actor/genre) |
| Email | Resend |
| Hosting | Vercel (serverless, `maxDuration: 120 s`) |

---

## Data Ownership

### What this app owns
- Transcripts in Vercel Blob (`transcripts/episode_NNN.json`, `transcripts/raw/…`)
- Search indices in Vercel Blob (`search-data/vector-store.json`, `search-data/bm25-index.json`)
- Query logs (`query-log/YYYY-MM/ql_*.json`)
- User feedback (`feedback-log/YYYY-MM/fb_*.json`)
- Share snapshots (`shares/…`)
- Transcription jobs (`jobs/*.json`)
- Episode metadata baked into the build (`src/lib/metadata-data.ts`)

### What this app reads but does not own
- Upstream podcast spreadsheet (Google Sheets `1RbtWP966CxA57PatyMcbJ6_ylg9tmCvDSLNxjmQ4bvk`) via service account
- TMDB film/cast data (enrichment only)
- Spotify & Patreon episode data (podreview feature)
- Audio files from Vercel Blob or local `mp3s/` directory

---

## Query Pipeline (the main search path)

```
User query
  │
  ▼
detectQueryIntent()         ← deterministic fast-path rules (src/lib/query-intent.ts)
  │ intent ≠ none →  metadata fast-path (notable moments / Tilda / aggregate)
  │ intent = none ↓
  ▼
classifyQuery()             ← Claude Haiku (src/lib/query-classifier.ts)
  │                           returns: type (factual|interpretive|hybrid), filters, confidence
  ▼
resolveSearchStrategy()     ← routing-policy.ts; may select 'agent' search
  │
  ├─ agent branch → runAgentSearch()   (src/lib/agent-search.ts)
  │                  LLM-driven tool-loop over full transcripts
  │
  └─ RAG branch:
       ├── queryEpisodes(filters)  ← metadata filter (src/lib/metadata-store.ts)
       └── hybridRetrieval()       ← BM25 + vector + RRF (src/lib/hybrid-retrieval.ts)
              │
              └── rerankChunks()   ← cross-encoder rerank (src/lib/reranker.ts)
                      │
                      ▼
              synthesizeHybridAnswerStreaming()   ← Claude Sonnet (src/lib/claude.ts)
                      │
                      ▼
              SSE stream → client
```

### Key routing decisions
- **Metadata fast-path** — intents with confidence ≥ threshold skip RAG and return
  deterministic answers from `metadata-data.ts`.
- **Agent search** — activated when `resolveSearchStrategy()` returns `'agent'`
  (configurable via `routing-policy.ts`). Falls back to RAG on error.
- **Quick vs deep synthesis** — `depth` param (default `quick`); deep uses more
  chunks, higher token budget, Sonnet.

---

## Key Modules

| Module | Role |
|---|---|
| `src/lib/metadata-data.ts` | Baked-in episode metadata array (populated at build time by `sync-metadata` + `enrich-tmdb`) |
| `src/lib/metadata-store.ts` | Query/filter/search helpers over metadata; normalises season-0 entries |
| `src/lib/query-classifier.ts` | LLM query classification → `ClassificationResult` |
| `src/lib/query-intent.ts` | Deterministic intent detection (fast-path rules) |
| `src/lib/hybrid-retrieval.ts` | BM25 + vector RRF merge |
| `src/lib/vectorstore.ts` | Loads/caches vector store from Blob; cosine similarity |
| `src/lib/bm25.ts` / `bm25-loader.ts` | BM25 index implementation and async loader |
| `src/lib/embeddings.ts` | OpenAI embedding generation |
| `src/lib/reranker.ts` | Cross-encoder reranking |
| `src/lib/claude.ts` | Anthropic client; `synthesizeHybridAnswerStreaming`, system prompts |
| `src/lib/agent-search.ts` | Agentic search loop over full transcript corpus |
| `src/lib/routing-policy.ts` | Centralised constants and routing decision helpers |
| `src/lib/blob-storage.ts` | Vercel Blob CRUD for transcripts, audio, jobs |
| `src/lib/query-logger.ts` | Fire-and-forget query logging to Blob |
| `src/lib/external-auth.ts` | Timing-safe key validation for `/api/external/search` |
| `src/lib/external-rate-limit.ts` | In-memory per-key two-tier rate limiter (short/daily) |
| `src/lib/podreview-auth.ts` | Simple Bearer token check for podreview endpoints |
| `src/lib/share-storage.ts` | Save/load share snapshots |
| `src/lib/metadata-aggregates.ts` | Pre-computed aggregate answers for common intent queries |

---

## Endpoint Reference

### Public / unauthenticated (rate limited by Vercel)

| Method | Path | Description |
|---|---|---|
| POST | `/api/search/stream` | Main streaming search (SSE). Body: `{query, limit?, offset?, depth?, variant?}` |
| POST | `/api/search` | Non-streaming search wrapper. Body: `{query, limit?, offset?}` |
| POST | `/api/search/followup` | Follow-up Q over existing sources. Body: `{query, followUpQuery, previousAnswer, sources}` |
| POST | `/api/share` | Save a search result for sharing. Returns `{id, url}` |
| GET | `/share/[id]` | View a shared result (page) |
| GET | `/api/stats?film=…` or `?episode=…` | Episode metadata stats |
| GET | `/api/kev?film=…` | "Kev question" for a film (metadata or Claude-generated) |
| GET | `/api/tilda?film=…` | "Who would Tilda play?" answers (metadata or Claude-generated) |
| GET | `/api/synopsis?film=…` | Episode synopsis extracted from transcript or Claude-generated |
| GET | `/api/guest?name=…` | Episodes by guest name |
| GET | `/api/playlist?film=…` | Music mentions + Spotify soundtrack for a film episode |
| GET | `/api/crew?…` | Crew data (directors/DP/cast) for episodes |
| POST | `/api/feedback` | Submit search feedback (name, rating, comment). Stored in Blob + optional email. |
| GET | `/api/feedback?month=…` | Read feedback. Token-gated if `FEEDBACK_API_TOKEN` set. |
| POST | `/api/eval/feedback` | Submit eval harness rating. No auth. |
| GET | `/api/eval/results` | Read eval harness results. No auth. |
| GET | `/api/eval/generate` | Generate adversarial eval questions. No auth. |
| GET | `/api/coverage` | Transcript coverage by episode. No auth. |
| GET | `/api/analytics/use-cases` | Query use-case analytics. No auth. |

### External consumer API (key-authenticated)

| Method | Path | Description |
|---|---|---|
| POST | `/api/external/search` | Same pipeline as `/api/search/stream` but synchronous, key-gated, rate-limited. `x-eh-key` header. |

### Protected endpoints (Bearer PODREVIEW_PASSWORD)

| Method | Path | Description |
|---|---|---|
| POST | `/api/podreview/auth` | Validate password, returns `{ok: true}` |
| GET/POST | `/api/podreview/episodes` | List episodes or load one by ID |
| GET/POST | `/api/podreview/tmdb-search` | Proxy TMDB search/detail |
| GET | `/api/podreview/match-episode` | Match Spotify + Patreon episode metadata |
| POST | `/api/podreview/submit` | Log new episode submission (no sheet write yet) |
| POST | `/api/podreview/update-pdc` | Write/update episode row in Google Sheets |

### Admin / internal (no auth unless noted)

| Method | Path | Description |
|---|---|---|
| POST | `/api/transcribe` | Start AssemblyAI transcription job. **No auth.** |
| POST | `/api/transcribe/webhook` | AssemblyAI completion webhook. **No auth (webhook secret not validated).** |
| GET | `/api/transcribe/status/[jobId]` | Poll transcription job status. |
| POST | `/api/blob-upload` | Client-side Vercel Blob upload token. **No auth — path-limited to `audio/`.** |
| GET/PUT/DELETE | `/api/transcripts/[episode]` | CRUD on transcript. **No auth.** |
| GET | `/api/transcripts` | List all transcripts. **No auth.** |
| GET | `/api/audio/[episode]` | Serve audio file. **No auth.** |
| POST | `/api/transcript-rename` | Rename transcript blob. **No auth.** |
| POST | `/api/cleanup-transcript` | AI cleanup of a transcript (streams). **No auth.** |
| POST | `/api/detect-samples` | Detect movie clips in transcript. **No auth.** |
| POST/GET | `/api/cleanup-feedback` | Log/read cleanup decisions. **No auth.** |
| GET | `/api/warmup` | Pre-warm vector store + BM25. Token-gated if `WARMUP_TOKEN` set. |
| POST | `/api/rebuild` | Trigger GitHub Actions ingest workflow. No request auth (relies on `GITHUB_PAT`). |
| POST | `/api/debug` | Query classifier debug output. **No auth.** |

### Deprecated / 410

- `POST /api/search` — still functional but considered deprecated in favour of the stream endpoint.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI embeddings |
| `ANTHROPIC_API_KEY` | Yes | Claude classification + synthesis |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Blob |
| `EH_EXTERNAL_KEYS` | Yes (prod) | Comma-separated `keyId:secret` pairs for `/api/external/search` |
| `ASSEMBLYAI_API_KEY` | Optional | Only needed for transcription |
| `TMDB_API_KEY` | Optional | Metadata enrichment + kev/tilda/synopsis fallback |
| `RESEND_API_KEY` | Optional | Feedback email notifications |
| `FEEDBACK_EMAIL` | Optional | Destination for feedback emails |
| `FEEDBACK_API_TOKEN` | Optional | Bearer token to read feedback via GET |
| `WARMUP_TOKEN` | Optional | Protects `/api/warmup` |
| `PODREVIEW_PASSWORD` | Optional | Bearer password for podreview endpoints |
| `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` | Optional | Google Sheets write access (JSON string) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Optional | Google Sheets write access (file path, local dev) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Optional | Podcast episode matching |
| `PATREON_CREATOR_TOKEN` | Optional | Patreon post matching |
| `GITHUB_PAT` | Optional | Trigger GitHub Actions ingest workflow |
| `NEXT_PUBLIC_BASE_URL` | Optional | Canonical base URL (needed for webhook construction) |
| `ALLOW_VARIANTS` | Optional | Set to `1` to enable search variant A/B testing in prod |
| `VERCEL_URL` | Injected | Used for webhook URL construction |

---

## Deprecated Paths

- **`POST /api/search`** — non-streaming search; superseded by `/api/search/stream`. Still functional, used internally.
- **`loadVectorStore()` (sync)** in `src/lib/vectorstore.ts` — marked `@deprecated`; use `loadVectorStoreAsync()`.

---

## Tech Debt & Known Issues

1. **No auth on transcript mutation endpoints** — `PUT /api/transcripts/[episode]`, `DELETE /api/transcripts/[episode]`, `POST /api/transcript-rename`, and `POST /api/transcribe` are unauthenticated. In production the only protection is Vercel's BLOB token being server-side only. See AUDIT-2026-06-09.md for details.

2. **AssemblyAI webhook has no secret validation** — any caller that knows the webhook URL can inject fake completion events. See AUDIT-2026-06-09.md.

3. **In-memory rate limiter** — `src/lib/external-rate-limit.ts` uses a process-local Map. Counts reset on every cold start and do not span Vercel lambda instances. Documented in the file as a known stopgap; should migrate to Upstash/Vercel KV when multiple consumers exist.

4. **`/api/debug` exposes internal classifier state** — returns full classification output with no authentication. Should be removed or gated.

5. **Hardcoded Google Sheet ID** — `1RbtWP966CxA57PatyMcbJ6_ylg9tmCvDSLNxjmQ4bvk` is baked into `update-pdc/route.ts`. Should move to an env var.

6. **Hardcoded upstream repo reference** — `jbennygold/transcript-app` in `rebuild/route.ts`. Will break if this fork is used as the primary deploy target.

7. **`/api/coverage` fetches every transcript in parallel** — unbounded `Promise.all` over all blobs; could be slow or OOM with a large corpus.

8. **`/api/speakers` is an N+1 over all transcripts** — loads every transcript to build a speaker list; no caching. Called infrequently but expensive.

9. **`/api/search/stream` has no request authentication** — any caller can trigger expensive Claude + OpenAI inference. Acceptable for a public app but worth monitoring.

10. **`podreview-auth.ts` does plain-string comparison** — the `checkAuth` function compares the bearer token with `=== ` rather than a constant-time comparison, making it theoretically vulnerable to timing attacks. Low severity given the low-value data protected.
