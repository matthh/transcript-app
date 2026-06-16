# Architecture — transcript-app

**Last reviewed: 2026-06-16**

> **Fork notice:** This is a fork of `jbennygold/transcript-app` (the live
> deployment at <https://transcript-app-blue.vercel.app>). Do **not** modify
> code files in this copy; only documentation changes are committed here.
> See `CLAUDE.md` at the repo root for the full policy.

---

## Purpose

AI-powered semantic search over 300+ episodes of the *Escape Hatch Podcast*
(a film-review show hosted by "Haitch" and Jason Goldman). Users type natural-
language questions; the app returns a synthesised answer with citations and
timestamps drawn from episode transcripts and structured metadata.

A secondary "PodReview" section is an internal production tool for submitting
episode data to a Google Sheet.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v3 |
| AI — classification | Claude Haiku (`claude-haiku-4-5-20251001`) |
| AI — synthesis | Claude Sonnet (`claude-sonnet-4-20250514`) |
| AI — agent search | Claude Sonnet (same model, tool-use loop) |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim / 512-dim variants) |
| Lexical search | BM25 inverted index (custom implementation, `src/lib/bm25.ts`) |
| Retrieval fusion | Reciprocal Rank Fusion (RRF) of vector + BM25 results |
| Reranking | `src/lib/reranker.ts` (cross-encoder style, post-RRF) |
| Transcription | AssemblyAI Universal-3 Pro (async webhook) |
| Storage — blobs | Vercel Blob (vector store, BM25 index, transcripts, audio, feedback) |
| Storage — metadata | JSON file committed to repo (`data/episode-metadata.json`) |
| Google Sheets | `googleapis` — PodReview writes episode data via service account |
| Email | Resend (feedback, transcription-error notifications) |
| TMDB | Film/director/actor enrichment |
| Spotify | Soundtrack lookups (Client Credentials, no per-user OAuth) |
| Hosting | Vercel (serverless, all API routes max 120 s) |
| Legacy vector DB | ChromaDB (`src/lib/chroma.ts`) — local dev only, superseded by Blob |

---

## Data ownership & flow

```
Episode metadata  ──── data/episode-metadata.json (committed)
                           │
                           ▼
                   metadata-store.ts  ────► API routes serving metadata queries
                           │
                  Google Sheet (source of truth, PodReview writes back to it)

Transcripts ──────── Vercel Blob  transcripts/episode_NNN.json
                           │
                   blob-storage.ts

Audio MP3s ───────── Vercel Blob  audio/episode_NNN.mp3
                    (uploaded via /api/blob-upload, client-side Vercel Blob)

Vector store ──────── Vercel Blob  search-data/vector-store-*.json
                           │
                   vectorstore.ts  (in-memory cache per Lambda warm instance)

BM25 index ───────── Vercel Blob  search-data/bm25-*.json
                           │
                   bm25-loader.ts  (in-memory cache per Lambda warm instance)
```

### Build pipeline

`npm run build` runs `scripts/build-orchestrator.ts` before the Next.js build.
The orchestrator bundles `data/episode-metadata.json` and any local transcript
JSON files into the Vercel Blob search data prefix so the deployed app can load
them at runtime.

`npm run ingest` (re)generates embeddings and BM25 index from transcript files
and uploads to Vercel Blob. Must be run whenever new transcripts are added.

---

## Query architecture (search pipeline)

All public search goes through `src/app/api/search/stream/route.ts` (streaming)
or `src/app/api/search/route.ts` (non-streaming). Both call `runSearch()` in
`src/lib/search-pipeline.ts`.

### Step-by-step

1. **Intent detection** (`lib/query-intent.ts`) — fast regex/keyword checks for
   special intents: latest-episode, episode-count, metadata-aggregate (Tilda
   scores, MMM counts, etc.), notable-moments, specific episode lookups. These
   skip the LLM classifier and return deterministic answers.

2. **LLM classification** (`lib/query-classifier.ts` → Claude Haiku) —
   classifies query as `factual | interpretive | hybrid` and extracts structured
   filters (`film`, `guest`, `director`, `genre`, `decade`, `season`, `yearRange`).
   Falls back to keyword heuristics if Haiku call fails.

3. **Routing policy** (`lib/routing-policy.ts`) — decides search strategy:
   - `metadata-only`: factual queries fully answered by structured data
   - `transcript-only`: interpretive queries needing quote retrieval
   - `hybrid`: needs both
   - `agent`: complex multi-step queries (Claude tool-use loop in `lib/agent-search.ts`)

4. **Metadata query** (`lib/metadata-store.ts`) — filters `episode-metadata.json`
   in memory using the extracted `FilterSpec`. Returns matching `EpisodeMetadata[]`.

5. **Hybrid retrieval** (`lib/hybrid-retrieval.ts`) — for transcript-needed
   strategies: generates query embedding (OpenAI), runs cosine vector search and
   BM25 lexical search in parallel, fuses via RRF, then reranks (`lib/reranker.ts`).

6. **Answer synthesis** (`lib/claude.ts` → Claude Sonnet) — `synthesizeHybridAnswerStreaming()`
   builds a context string from metadata + chunks and streams a markdown answer.
   Token budget is adaptive (700 tokens for quick/Haiku, up to 4096 for deep/Sonnet).

7. **Query logging** (`lib/query-logger.ts`) — every search writes a log entry
   to Vercel Blob (`query-logs/`). Drives the analytics and eval system.

---

## Endpoint reference

### Public search

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/search/stream` | Primary search endpoint, SSE streaming response |
| `POST` | `/api/search` | Non-streaming search (same pipeline) |
| `POST` | `/api/search/followup` | Follow-up question on a prior result |

### External / partner API

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/external/search` | `x-eh-key` bearer key | Rate-limited partner search endpoint |

Authentication: comma-separated `keyId:secret` pairs in `EH_EXTERNAL_KEYS` env var.
Rate limit: 60 req / 10 min + 500 req / 24 h per key (in-memory, per Lambda instance).

### Episode metadata & content

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stats?film=…` | Per-episode stats (MMM count, guest, notable moments, etc.) |
| `GET` | `/api/crew?name=…` | Episodes featuring a director / actor / cinematographer |
| `GET` | `/api/guest?name=…` | Episodes by guest name |
| `GET` | `/api/coverage` | Transcript coverage dashboard data |
| `GET` | `/api/kev?film=…` | Kev's question for an episode (real or AI-generated) |
| `GET` | `/api/synopsis?film=…` | Episode synopsis (extracted from transcript or AI-generated) |

### Transcripts

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/transcripts` | List all transcript metadata |
| `GET` | `/api/transcripts/[episode]` | Fetch single transcript |
| `PUT` | `/api/transcripts/[episode]` | Save/update transcript (review tool) |
| `DELETE` | `/api/transcripts/[episode]` | Delete transcript |
| `POST` | `/api/transcript-rename` | Rename episode in transcript |

### Audio

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/blob-upload` | Client-side Vercel Blob upload (audio files, max 500 MB) |
| `GET` | `/api/audio/[episode]` | Stream audio (filesystem in dev, redirects to Blob URL in prod) |

### Transcription pipeline

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/transcribe` | Submit audio URL to AssemblyAI for transcription |
| `GET` | `/api/transcribe/status/[jobId]` | Poll transcription job status |
| `POST` | `/api/transcribe/webhook` | AssemblyAI webhook (job completion callback) |
| `POST` | `/api/transcription-error` | User-submitted transcription error report (sends Resend email) |

### Transcript review / cleanup

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/cleanup-transcript` | AI-assisted transcript cleanup suggestions (batched) |
| `POST` | `/api/detect-samples` | Detect movie clip / interview samples in transcript |
| `POST` | `/api/cleanup-feedback` | Log accept/reject decisions for cleanup suggestions |

### Sharing

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/share` | Create a share link for a search result |
| `GET` | `/share/[id]` | Public shareable page for a result |

### PodReview (internal production tool)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/podreview/auth` | — | Password check (`PODREVIEW_PASSWORD` env) |
| `GET/POST` | `/api/podreview/tmdb-search` | Bearer `PODREVIEW_PASSWORD` | TMDB movie search / detail lookup |
| `GET` | `/api/podreview/episodes` | Bearer `PODREVIEW_PASSWORD` | List existing episodes |
| `GET` | `/api/podreview/match-episode` | Bearer `PODREVIEW_PASSWORD` | Match a film to an episode |
| `POST` | `/api/podreview/submit` | Bearer `PODREVIEW_PASSWORD` | Log submission data (sheet write not yet enabled) |
| `POST` | `/api/podreview/update-pdc` | Bearer `PODREVIEW_PASSWORD` | Write episode row to Google Sheet |

PodReview auth is a single shared password — no per-user sessions.

### Operations / dev

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/warmup` | Optional `WARMUP_TOKEN` | Pre-load vector store + BM25 index (cold-start mitigation) |
| `GET` | `/api/rebuild` | — | Check if GitHub PAT is configured |
| `POST` | `/api/rebuild` | — | Trigger `ingest-episode.yml` GitHub Actions workflow |
| `POST` | `/api/debug` | — | Classify a query and show metadata match results |
| `POST` | `/api/detect-samples` | — | Debug: detect movie clips in a transcript batch |

### Evaluation & analytics

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/eval/results` | Fetch eval run results from Blob |
| `POST` | `/api/eval/generate` | AI-generate adversarial eval questions |
| `POST` | `/api/eval/feedback` | Record thumbs-up/down on a generated answer |
| `POST` | `/api/feedback` | User feedback on search results (stores to Blob, emails via Resend) |
| `GET` | `/api/analytics/use-cases` | Weekly use-case breakdown from query logs |

---

## Key modules

| File | Role |
|---|---|
| `src/lib/query-classifier.ts` | LLM (Haiku) + fallback heuristic query classification |
| `src/lib/query-intent.ts` | Fast deterministic intent detection (latest ep, counts, etc.) |
| `src/lib/routing-policy.ts` | Maps classification → search strategy; model/token constants |
| `src/lib/metadata-store.ts` | In-memory episode metadata store, filter engine |
| `src/lib/metadata-data.ts` | Raw metadata loading from `data/episode-metadata.json` |
| `src/lib/hybrid-retrieval.ts` | RRF fusion of vector + BM25 results |
| `src/lib/reranker.ts` | Cross-encoder style reranking of retrieved chunks |
| `src/lib/vectorstore.ts` | Vector store loader (Vercel Blob, in-memory cache) |
| `src/lib/bm25.ts` | BM25 implementation |
| `src/lib/bm25-loader.ts` | BM25 index loader (Vercel Blob, in-memory cache) |
| `src/lib/claude.ts` | Anthropic client, `synthesizeHybridAnswerStreaming()`, system prompts |
| `src/lib/embeddings.ts` | OpenAI embedding generation |
| `src/lib/agent-search.ts` | Agentic search loop (Claude tool-use, multi-step retrieval) |
| `src/lib/blob-storage.ts` | Vercel Blob CRUD for transcripts, audio, job metadata |
| `src/lib/external-auth.ts` | API key validation for `/api/external/search` |
| `src/lib/external-rate-limit.ts` | In-memory two-tier rate limiter |
| `src/lib/share-storage.ts` | Vercel Blob CRUD for shared results |
| `src/lib/query-logger.ts` | Per-query log writes to Vercel Blob |
| `src/lib/podreview-auth.ts` | Bearer-password auth for PodReview routes |
| `src/lib/spotify.ts` | Spotify Client Credentials token + soundtrack lookup (in-memory cache) |
| `src/lib/chroma.ts` | ChromaDB client (legacy local dev only) |
| `src/lib/lexicon.ts` | Podcast-specific keyterms for AssemblyAI prompts |

---

## Pages

| Route | Purpose |
|---|---|
| `/` | Main search UI |
| `/review/new` | New transcript review (upload + transcription flow) |
| `/review` | Transcript list |
| `/review/[episode]` | Transcript editor / speaker mapper |
| `/share/[id]` | Public share page for a search result |
| `/coverage` | Transcript coverage dashboard |
| `/podreview` | Internal episode-submission tool |
| `/analytics` | Use-case analytics dashboard |
| `/eval` | Evaluation harness UI |
| `/docs/query-journey` | Internal: visual query pipeline diagram |
| `/docs/query-failure-modes` | Internal: known failure-mode taxonomy |

---

## Deprecated paths

- **ChromaDB** (`src/lib/chroma.ts`) — superseded by Vercel Blob vector store.
  The `chromadb` package remains in `dependencies` but is only used in local dev
  scripts that have not yet been deleted.
- **Local filesystem transcript serving** — the `GET /api/transcripts/[episode]`
  and `GET /api/audio/[episode]` routes contain filesystem fallback paths for
  local development. In production all data comes from Vercel Blob.

---

## Known tech debt & gotchas

**T-1 — In-memory rate limiting is per-Lambda-instance**
`src/lib/external-rate-limit.ts` explicitly notes the counter resets when the
Lambda instance is recycled. Under a multi-instance Vercel region, limits can
be exceeded. Recommended fix: Upstash Redis / Vercel KV.

**T-2 — `/api/debug` is unauthenticated**
`POST /api/debug` runs a live LLM query classification and returns full
internal metadata. No auth check. Safe only if the route is undiscovered, but
exposes query planner internals.

**T-3 — `/api/rebuild` is unauthenticated**
`POST /api/rebuild` triggers a GitHub Actions workflow using `GITHUB_PAT`. The
route itself has no auth guard — any caller who discovers it can trigger
arbitrary CI runs against `jbennygold/transcript-app`.

**T-4 — PodReview password auth is shared & plain-text compared**
`src/lib/podreview-auth.ts` uses `===` string comparison (not timing-safe) on a
single shared password. No brute-force protection.

**T-5 — PodReview submit does not write to the sheet**
`POST /api/podreview/submit` only logs to console and returns the formatted row;
`POST /api/podreview/update-pdc` contains the actual Google Sheets write path.
The two routes have a confusing split with no clear UI distinction.

**T-6 — AssemblyAI webhook has no signature verification**
`POST /api/transcribe/webhook` accepts any POST that provides a known `transcript_id`.
An attacker who can guess or enumerate job IDs could inject a fake "completed"
payload and overwrite transcripts in Blob storage.

**T-7 — TMDB API key exposed in query string (server-side only)**
`GET /api/kev` and the TMDB enrichment script forward `api_key` as a query
parameter. While this is server-to-server, TMDB recommends bearer token auth;
the key would appear in server logs/traces.

**T-8 — Feedback and cleanup data stored as public Blobs**
`api/feedback`, `api/cleanup-feedback`, `api/eval/feedback` write to Vercel
Blob with `access: 'public'`. Anyone with the predictable pathname can read
user feedback including query text and names.

**T-9 — Vector store and BM25 index cached indefinitely in Lambda memory**
Cold starts load both indices; warm instances never refresh. A Vercel
redeploy clears instances, but a long-lived warm instance will serve stale
search data after a re-ingest.

**T-10 — Query logs are public Blobs**
`lib/query-logger.ts` writes per-query logs to Vercel Blob with `access: 'public'`.
These contain full user queries and answer metadata.

**T-11 — Google Sheets ID hardcoded**
`src/app/api/podreview/update-pdc/route.ts` contains `SHEET_ID =
'1RbtWP966CxA57PatyMcbJ6_ylg9tmCvDSLNxjmQ4bvk'` as a string literal.

**T-12 — GitHub repo name hardcoded**
`src/app/api/rebuild/route.ts` contains `GITHUB_REPO = 'jbennygold/transcript-app'`
as a literal; calls `master` branch. Moving the repo or changing the default
branch silently breaks this.

**T-13 — `detect-samples` and `cleanup-transcript` instantiate `new Anthropic()`
without re-using the singleton**
These two files call `new Anthropic()` directly instead of `getAnthropic()`
from `lib/claude.ts`, creating extra client instances per invocation.

**T-14 — No input sanitisation on `episodeTitle` in email HTML**
`POST /api/transcription-error` interpolates `episodeTitle`, `selectedText`,
`correctedText`, and `reporterName` directly into an HTML email string without
escaping. A malicious reporter could inject HTML into the notification email.
