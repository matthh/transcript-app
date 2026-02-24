# Plan v3: Search Quality & Reliability

## Goals
- Improve intent routing accuracy and eliminate silent dead‑ends.
- Raise retrieval quality with better ranking, deduplication, and metadata‑informed search.
- Lower tail latency by parallelizing the right things (classification + embedding, not metadata).
- Make quality measurable with metrics and CI gates on the existing eval harness.
- Ensure metadata freshness and consistency.

## Scope
- Search API flow (`/api/search` and `/api/search/stream`)
- Intent detection + classification
- Metadata retrieval + transcript retrieval
- Answer synthesis (quick Haiku pass + optional deep Sonnet expansion)
- Evaluation + monitoring
- Metadata data quality and refresh process

## Current Architecture (Reference)

The search pipeline:

1. **Intent detection** — sync regex/substring matching with confidence levels (high/medium/low).
   If matched → metadata fast‑path (sub‑ms). If fast‑path returns null → falls through to full pipeline.
   Includes guest search one‑box intent.
2. **LLM classification + embedding generation** (run in parallel, 300–800ms) — classification
   returns type (factual/interpretive/hybrid), confidence (clamped 0.5–0.95), and filters.
   Embedding is precomputed and passed to transcript retrieval.
3. **Metadata search** — in‑memory array scan, sub‑ms. Uses filters from step 2.
4. **Transcript search** — precomputed embedding + vector similarity + BM25, then
   Reciprocal Rank Fusion, keyword boosting, and episode diversification (max 2 per episode,
   dynamic cap to 4).
5. **Synthesis** — routing based on query type and transcript depth signal.
   Factual + metadata-answerable (`requiresTranscriptDepth: false`): Haiku 4.5, 4 chunks, 700 tokens (quick mode).
   Factual + transcript-depth (`requiresTranscriptDepth: true`): Haiku 4.5, all chunks, 700 tokens.
   Interpretive/hybrid auto-deep: Sonnet 4, all chunks (`a90315c`).
   Deep mode (on demand): Sonnet 4, all chunks.

Key existing assets: 36‑case eval dataset with A/B harness, query logging to Vercel Blob,
user feedback collection (thumbs up/down + comments), feedback‑to‑eval pipeline.

---

## Phase 1: Routing & Latency Foundations (1–2 weeks)

### 1.1 Expand Metadata Intents ✅ (Complete)
**Why:** Deterministic metadata lookups should bypass transcript search.

**Completed Work (2026‑02‑12):**
- Reviewer, guest, release date, and Kev's Question intents implemented.
- Regression cases added and passing for all four intent types.
- A/B harness for metadata intent testing created and output logged.

**Additional work (2026‑02‑11):**
- Guest search one‑box intent (`metadata_guest_search`) added — "what episodes feature X as guest" returns formatted episode list from metadata.
- Reviewer credit footer displayed in one‑box and share page results.

**Remaining:**
- Normalize film titles (strip year/parentheticals) during matching.
- Episode‑number variant regression cases (e.g., "episode 204" for each intent).

### 1.2 Universal Fallthrough on Failed Metadata Intents ✅ (Complete)
**Why:** When intent detection fires but the metadata lookup returns null (film not found,
field missing), most intents dead‑end silently. Only `metadata_tilda` and
`metadata_notable_moments` fall through to the full pipeline. This is a silent failure mode.

**Completed (2026‑02‑11):**
- All intent types now fall through to the full pipeline when metadata lookup returns null.
- Failed fast‑path attempts are logged in routing telemetry.

### 1.3 Confidence‑Based Routing (Partially Complete)
**Why:** Misroutes are high‑cost. Today intent detection has no confidence signal (binary
regex match) and classification confidence is uncalibrated (LLM‑reported, clamped).

**Deliverables:**
- **1.3a** ✅ Add a `confidence` field to `QueryIntent`. Regex exact‑match intents get high
  confidence; substring/fuzzy film matches get medium; ambiguous patterns get low.
  *(Completed 2026‑02‑11)*
- **1.3b** Calibrate classification confidence: run the eval dataset, compare LLM‑reported
  confidence to actual correctness, and adjust thresholds or add heuristic corrections.
- **1.3c** Routing policy:
  - Intent confidence high → metadata fast‑path (existing behavior).
  - Intent confidence medium → run metadata fast‑path AND fall through to full pipeline,
    return whichever is better.
  - Classification confidence low + filters empty → treat as hybrid regardless of LLM label.
- **1.3d** ✅ Log routing decisions (intent type, confidence, classification type, confidence,
  chosen path) to query log for auditing. *(Completed 2026‑02‑11)*

**Remaining:** 1.3b (calibration) and 1.3c (routing policy).

**Success Criteria:**
- <5% of metadata‑answerable queries fall back to transcript‑only unnecessarily.
- <5% of interpretive queries get routed metadata‑only.
- Routing decision log populated for all queries.

### 1.4 Latency: Parallelize Classification + Embedding Generation ✅ (Complete)
**Why:** The real latency bottleneck is sequential: classification (300–800ms LLM call) must
complete before transcript search starts. Metadata search is already sub‑ms and not worth
parallelizing separately.

**Completed (2026‑02‑11):**
- Classification and embedding generation now run in parallel via `Promise.all`.
- `hybridRetrieval` accepts a `precomputedEmbedding` parameter; embedding failures
  fall back gracefully to internal generation.
- Cold‑start timeout exists for transcript retrieval.

**Remaining:**
- Make transcript retrieval timeout configurable for the normal (non‑cold‑start) path.

---

## Phase 2: Retrieval Quality (2–3 weeks)

### 2.1 Improve Reranking + Deduplication
**Why:** Hybrid retrieval returns noisy or redundant chunks. Episode diversification exists
(max 2 per episode, dynamic cap to 4) but there is no semantic deduplication or reranking.

**Deliverables:**
- Add a lightweight reranker (cross‑encoder or small LLM) for the top‑N chunks after
  RRF fusion + keyword boosting.
- Deduplicate near‑identical transcript chunks (e.g., overlapping text windows from the
  same episode) using text similarity threshold before diversification.
- Improve episode diversification: for queries targeting a specific episode (detected via
  film filter), increase the per‑episode cap dynamically.

**Success Criteria:**
- Improved MRR/Recall@k on eval dataset.
- Reduced repetition in synthesis outputs.

### 2.2 Generalize Metadata Fallbacks
**Why:** Strict filters lead to empty results. A year‑filter fallback already exists in
the route handler but it's one‑off logic.

**Deliverables:**
- Generalize the existing year‑filter fallback into a reusable filter relaxation strategy:
  try full filters → if 0 results, drop secondary filters (keep film/guest exact) → retry.
- Return a structured "closest matches" list with rationale when relaxation was applied.
- Ensure metadata contributes context even for interpretive queries (episode title, guest,
  reviewer as context for synthesis).

**Success Criteria:**
- Fewer "No matching episodes" for answerable queries.
- Eval cases with edge‑case filters pass.

### 2.3 Metadata‑Informed Transcript Retrieval ✅ (Complete)
**Why:** When the classifier extracts a film or episode filter, transcript search runs
completely independently. Chunks from the relevant episode should be prioritized.

**Completed (2026‑02‑12):**
- Added `boostTargetedEpisodes()` in `hybrid-retrieval.ts`: 1.5x multiplicative score
  boost for chunks from metadata-matched episodes after RRF fusion + keyword boosting.
- Extended `diversifyByEpisode()` with `targetEpisodeTitles` parameter: when ≤3 targeted
  episodes, their per-episode cap is raised to `maxPerEpisode * 3` (6 instead of 2).
  Merges with existing keyword-concentration override via `Math.max()`.
- Normalized all `episodeCapOverrides` keys to lowercase for consistent lookup.
- Route handlers (`route.ts` and `stream/route.ts`) construct `targetEpisodeTitles` from
  metadata results when the set is focused (≤10 episodes with at least one filter matched).
- Added eval case: "Targeted episode: Starman Hatch News segment".

**Success Criteria:**
- Queries like "what did they say about Alien" return more chunks from the Alien episode.
- No degradation on broad/cross‑episode queries (eval regression check).

---

## Phase 3: Evaluation & Monitoring (2 weeks, parallel with Phases 1–2)

### 3.1 Extend Existing Eval Harness with Metrics + CI
**Why:** The eval harness (36 cases, A/B comparison, tag filtering) exists but produces
only pass/fail assertions. Quantitative metrics and CI integration are missing.

**Starting point:** `scripts/eval-search.ts`, `data/eval-dataset.json` (36 cases),
A/B mode with `--baseline`/`--candidate`.

**Deliverables:**
- Add quantitative metrics: Recall@k, MRR, latency percentiles (p50/p95/p99),
  answerability rate (% of queries that produce a non‑empty answer).
- Add eval cases for:
  - Intent detection fast‑path correctness (verify routing, not just answer content).
  - Quick vs. deep mode comparison.
  - Failed intent fallthrough (nonexistent film queries).
- CI gate: run eval on PR, fail if pass rate drops below threshold or p95 latency regresses.
- Machine‑readable output (JSON) for trend tracking across runs.

**Success Criteria:**
- Automated eval report on each PR or nightly build.
- Eval dataset grows to 50+ cases covering all intent types and edge cases.

### 3.2 Improve Query + Feedback Logging
**Why:** Query logs and feedback logs have no join key. Query logs don't capture intent
detection results or synthesis model. Routing decisions are invisible.

**Deliverables:**
- Add a `queryId` field to query log entries. Return it in the API response so the
  feedback endpoint can include it, creating a join between query and feedback logs.
- Extend `QueryLogEntry` to capture: intent detection result (type + confidence),
  synthesis model used, depth parameter, and routing path taken.
- Build a lightweight aggregation script that reads logs from Blob and produces a
  weekly triage report: top failure modes, routing distribution, latency trends.

**Success Criteria:**
- Every feedback entry links to its query log entry.
- Weekly report identifies top‑N failure reasons with trend lines.

---

## Phase 4: Metadata Quality & Freshness (2–3 weeks)

### 4.1 Metadata Canonicalization
**Why:** Inconsistent naming breaks filters. Current metadata search uses substring
`includes()` matching, which causes false positives (e.g., film filter "the" matches
every title containing "the").

**Deliverables:**
- Normalize fields: guest, reviewer, film titles (strip year, punctuation, casing rules).
- Build canonical entity lists (guests, reviewers, films) for exact matching + synonyms.
- Replace substring matching with exact‑match‑first, synonym‑match‑second, then fuzzy
  as a last resort with lower confidence.
- Add spurious filter cleanup for guest/director/actor (currently only film is cleaned).

**Success Criteria:**
- Reduced filter misses for known entities.
- Reduced false‑positive matches from substring collisions.

### 4.2 Automated Metadata Sync
**Why:** Metadata lives in a static TypeScript file (`metadata-data.ts`) generated at
build time. Manual updates drift.

**Deliverables:**
- Scheduled sync from source of truth (e.g., Google Sheet) to Vercel Blob.
- Validation checks (required fields, duplicates, missing film year, TMDB enrichment
  completeness).
- A diff report that highlights changes before the data is promoted to production.

**Success Criteria:**
- Metadata freshness < 7 days from source updates.
- No silent data quality regressions (validation catches missing/malformed entries).

---

## Open Question: Quick Mode Scope (2026-02-11)

### Problem
Auto-deep (committed `a90315c`) routes interpretive/hybrid queries to Sonnet + all chunks
even in quick mode. This fixes queries like "who says yeah more, jason or matt" but does NOT
fix **transcript-search factual** queries that the classifier labels `factual`:

- "Did Haitch ever have a band? Did they ever open for another famous act?"
- "In what context has River Phoenix been mentioned on the podcast?"

Both are factual in nature (yes/no, list of instances) but the answer is buried in transcripts,
not in metadata. With `factual` classification they get 4 chunks + Haiku + 700 tokens — the
relevant chunk ranks 5th+ and gets cut. Deep mode finds it because it uses all chunks.

### Root Cause
The classifier's `factual` label conflates two different things:
1. **Metadata-answerable** — "How many episodes?", "Proto episodes", "80s movies"
   → genuinely works with 4 chunks because the answer is in structured data.
2. **Transcript-search factual** — "Has River Phoenix been mentioned?", "Did Haitch have a band?"
   → factual in nature but requires full transcript retrieval depth.

Adding priority rules for specific patterns (e.g., "Did [person] ever...") is whack-a-mole.
The underlying issue is that quick synthesis only works when the answer is in metadata or the
top few transcript chunks.

### Options Under Consideration

**Option A: Flip the default — quick only for metadata-primary answers**
Only use Haiku/4-chunk synthesis when the answer came primarily from metadata (e.g., intent
detection fast-path hit, or transcript chunks contributed little). All other queries get full
depth. Simple, but increases average cost/latency since most queries would go deep.

**Option B: Add a classifier signal `requiresTranscriptDepth`**
Separate from factual/interpretive. The classifier would output an additional boolean indicating
whether the query needs deep transcript search. Quick synthesis only applies when
`requiresTranscriptDepth: false`. Adds complexity to the classification prompt but is precise.

**Option C: Drop the 4-chunk limit, keep Haiku for factual speed**
Always pass all retrieved chunks to synthesis regardless of depth. Factual queries still use
Haiku (fast, cheap) but see all 6-15 chunks instead of 4. Deep mode switches to Sonnet for
higher quality. Simplest change — removes the chunk slicing entirely — but increases Haiku
input token cost for every factual query.

**Option D: Increase quick chunk count (e.g., 4 → 8)**
A pragmatic middle ground: raise `QUICK_SYNTHESIS.maxChunks` so more transcript-search factual
queries land in the window. Doesn't fully solve the problem but reduces the failure rate without
adding complexity. Could combine with Option B for a complete solution.

### Decision (Updated 2026-02-12)
Based on recent failed/low-quality user queries (Truthsayer segment lookup, frequent
voicemailer ranking, repeated-phrase lookups like "you hack", and Haitch band-history
queries), the current boundary (`factual` => Haiku + 4 chunks) is not reliable.

These queries are factual in form but transcript-heavy in evidence requirements, often
cross-episode and multi-instance. They fail when synthesis only sees the top few chunks.

**Adopted approach: Option C now, Option B next.**

- **Immediate policy (Option C for transcript-path factual):** ✅ Implemented (`10e432a`)
  Removed 4-chunk slicing for factual queries; Haiku sees all retrieved chunks.
  Eval: 36/37 passed (1 rate-limit 429). Dingus voicemail flipped FAIL→PASS.
- **Follow-up control layer (Option B):** ✅ Implemented (2026-02-12)
  Added classifier signal `requiresTranscriptDepth` (LLM prompt + sync fallback).
  Metadata-answerable factual queries (`requiresTranscriptDepth: false`) get cheap quick
  mode (4 chunks, Haiku, 700 tokens). Transcript-search factual queries keep full depth.
  Eval: 41/44 passed (3 pre-existing failures unrelated to this change).
- **Aggregation-query carve-out:** ✅ Covered by Option B
  Queries asking for frequency/ranking/count across speakers/voicemailers/phrases are
  classified as `transcriptDepth: true` by the LLM prompt, defaulting to full depth.

Option D (4 -> 8) is considered insufficient as a standalone fix; it may be used only as
a temporary mitigation if rollout constraints block immediate Option C behavior.

### Sequencing Relative to the Rest of the Plan
Option C and Option B are Phase 1.5 priority work and should be completed before Phase 2
retrieval-quality initiatives. They address current user-visible failures more directly than
reranking/deduplication alone.

---

## Open Question: Full-Catalog Queries (2026-02-12)

### Problem
Query: "Review every movie the podcast has covered, then suggest 10 more films they should
definitely have on their upcoming schedule." ([share link](https://search.escapehatchpod.com/share/shr_mljh8n2b_yll822))

The system only listed ~10 films and declined to recommend, even though we have metadata for
all ~297 episodes. The model had no idea what films the podcast has covered.

### Root Cause
`route.ts` line 461-469 guards against stuffing 300+ episodes into the synthesis prompt:

```ts
if (filtersMatched > 0 || (filtersRequested === 0 && result.totalCount <= 50)) {
  metadataEpisodes = result.episodes;
```

This query has no filters, so `filtersRequested === 0`. But `totalCount` is ~297 (> 50), so
the condition fails and **zero metadata episodes are passed to synthesis**. The model only
sees transcript chunks and can't answer catalog-wide questions.

The guard exists for a good reason — passing 297 full episode objects to synthesis would blow
up context/cost. But queries like "suggest movies they should cover" or "what genres have they
focused on" genuinely need catalog-level awareness.

### Options to Consider

**Option A: Compact catalog summary**
When the query has no filters and totalCount > 50, pass a lightweight summary (film titles +
years only, no full metadata) to synthesis. ~297 titles at ~20 tokens each ≈ 6K tokens —
manageable. Could be a pre-formatted string injected into the synthesis prompt.

**Option B: Classifier signal `needsFullCatalog`**
Add a boolean to classification output. When true, inject the compact catalog summary.
Queries like "suggest movies", "what haven't they covered", "genres breakdown" would trigger it.

**Option C: Always include compact film list**
Always inject a short film-title list into synthesis regardless of query. Low cost (~6K tokens)
and removes the edge case entirely, but adds tokens to every query.

### Decision
TBD — related to the broader question of how much metadata context synthesis should see.

---

## Phase 3b: Classifier & Synthesis Stabilization (2026-02-24)

### 3b.1 Always-On Deterministic Film Detection ✅ (Complete)
**Why:** `findFilmFromQuery()` only ran when the LLM failed to extract a film filter. When
Haiku *did* extract one (but inconsistently or without the year suffix), the fallback never
fired. This caused flaky episode-scoped retrieval (~80% pass rate for "They Live" queries).

**Fix:** Always run `findFilmFromQuery()` and prefer the canonical catalog match over
LLM extraction. The catalog entry includes the year suffix and is guaranteed to match metadata.

### 3b.2 Film Filter Fallback in Route Handlers ✅ (Complete)
**Why:** `targetEpisodeTitles` was only built from metadata query results. When the metadata
query returned 0 results (e.g., extra filters like `host` narrowed too aggressively), the
film filter was lost before reaching retrieval — injection, boosting, and diversification
all skipped.

**Fix:** Both route handlers now fall back to `classification.filters.film` when
`metadataEpisodes` is empty, ensuring retrieval always targets the detected episode.

### 3b.3 Synthesis Few-Shot Examples for Rules #9/#10 ✅ (Complete)
**Why:** Rules #9 (implicit knowledge bridging) and #10 (multi-referent coverage) existed as
imperative instructions but the LLM inconsistently followed them — rules #1-2 ("don't
invent") competed with #9, and no examples showed correct vs incorrect behavior.

**Fix:** Added explicit PROCEDURE steps (a/b/c checklists) and WRONG/RIGHT example pairs to
both rules. Examples use different content than test cases to ensure generalization.

**Eval impact:** They Live (FM-03) now passes consistently (3/3). Zelda multi-referent and
Wachowskis/Bound remain flaky (retrieval-level issues, not synthesis-only).

---

## Risks & Mitigations
- **Over‑routing to transcripts increases cost** → gate by confidence; timeout transcript
  retrieval; factual quick mode uses Haiku (all chunks but cheap model) to keep cost manageable.
- **Reranker latency** → cap N, pre‑filter with hybrid retrieval, skip reranking in
  quick mode if latency budget is tight.
- **Canonicalization false merges** → keep raw fields alongside normalized variants;
  prefer exact match over fuzzy.
- **Parallel embedding + classification race condition** → embedding is query‑only and
  does not depend on classification output; no shared mutable state.
- **Confidence calibration is hard** → start with coarse buckets (high/medium/low) based
  on match type rather than numeric thresholds; refine with eval data.

---

## Dependencies
- Access to transcript index + metadata source of truth.
- Compute budget for reranking (cross‑encoder or LLM calls).
- OpenAI embedding API reliability (mitigated by retry/backoff, added 2026‑02‑12).
- Existing eval dataset (36 cases) and A/B harness as starting points.

---

## Suggested Next Steps
*Items 1.2, 1.3a, 1.3d, and 1.4 were completed 2026‑02‑11.*

1. Calibrate classification confidence against eval dataset (1.3b).
2. Implement confidence‑based routing policy (1.3c) — medium‑confidence intents run both paths.
3. ~~Implement quick-mode decision above: remove 4-chunk slicing for transcript-path factual queries; keep Haiku.~~ ✅ Done (`10e432a`).
4. ~~Add `requiresTranscriptDepth` signal and initial heuristics (aggregation/frequency/ranking queries => true).~~ ✅ Done (2026-02-12).
5. ~~Expand eval set with high-impact transcript-factual cases (Truthsayer, frequent voicemailers, "you hack", Haitch band mentions).~~ ✅ Done (`83d8548`).
6. Normalize film titles in intent matching (1.1 remaining).
7. Make transcript retrieval timeout configurable (1.4 remaining).
8. ~~Begin Phase 2 with metadata-informed transcript boosting (2.3).~~ ✅ Done (2026-02-12).
9. Continue Phase 2 reranking + deduplication (2.1).
