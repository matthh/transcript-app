# Design: LLM Topic Extraction for Chunk-Level Retrieval

**Author**: Claude (AI pair programmer)
**Date**: 2026-02-26
**Status**: Proposed
**Scope**: Add LLM-generated topic summaries as supplemental embedding vectors to improve retrieval of incidental personal/lifestyle content buried in film-dominated chunks

---

## 1. Motivation

### 1.1 The Problem

Queries about personal topics (food, clothing, hobbies, physical descriptions) consistently fail because the relevant content is mentioned incidentally during film discussions. Chunk embedding vectors are dominated by the episode's primary topic — a 1,500-token chunk about Fast Times at Ridgemont High that includes 2 sentences about Haitch's favorite shorts will embed near "Fast Times" queries, not "shorts" queries.

This is the same root cause behind FM-15 (personal/lifestyle retrieval gap), which was previously fixed for food preferences via category-specific sub-chunking. But sub-chunking per category doesn't scale — we'd need separate detectors for food, clothing, hobbies, physical appearance, pets, props, and every future category users ask about.

### 1.2 Evidence from User Feedback

12 of 17 submitted feedback entries are negative. After filtering out cases already fixed (Boorman/director scoping, "we'll get there"/agent routing) and cases needing agent routing (props listing, repeated phrases), the open cluster is **personal/lifestyle retrieval**:

| # | Query | Comment | FM |
|---|-------|---------|-----|
| 6 | "What does Jason think of fishing" | Only hit one ep | FM-15 |
| 10 | "describe the perfect kind of Shorts I should buy for Haitch" | Should have found chubbies shorts | FM-15 |
| 11 | "detailed physical descriptions of Jason and Haitch" | Feels like vamping with non-relevant details | FM-15 + FM-11 |
| 12 | "hosts' thoughts about inseams on shorts?" | Why referencing a specific episode | FM-15 + FM-11 |
| 2 | "What do we know about Corey's attraction to whips" | Should have found Corey quote | FM-04 + FM-15 |
| 8 | "what would Jason's offering have been interviewing for the new CEO of Twitter" | Galaxy Quest moment | FM-04 |
| 9 | "examples of cool desks in the film" | Why is Conan mentioned? | FM-09 + FM-11 |

Cases 6, 10, 11, 12 are the core FM-15 cluster. Cases 2, 8, 9 have partial FM-15 overlap.

### 1.3 Why Not More Sub-Chunking?

The pattern from Phases 4+ and 5 — identify a retrieval gap, write a keyword-based detector, create sub-chunks, re-ingest — works but requires:
- A new detector function per category (food, catchphrases, segments, now clothing? hobbies? appearance?)
- Manual keyword curation per category
- Full re-ingest each time a new category is added
- No coverage for categories we haven't thought of yet

Topic extraction solves this generically: one LLM call per chunk at ingest time produces a summary that captures *all* incidental topics, regardless of category.

### 1.4 planv4 Alignment

- **Phase 2d-3** (FM-15): Documented as resolved via personal-aside sub-chunking, but only for the food-preference subcategory. The broader problem persists for clothing, hobbies, physical descriptions, and other personal topics.
- **Phase 3d** (synthesis anti-fabrication): Three prompt-level approaches tried and reverted. Key finding: FM-15 is a retrieval problem, not a synthesis problem. The model fabricates when retrieval delivers tangential chunks and zero direct evidence.
- **Design principle**: "Correctness over cleverness" — topic extraction provides correct retrieval signals rather than cleverly engineering around bad retrieval with prompt tricks.

---

## 2. Design

### 2.1 Overview

At ingest time, run each chunk through Haiku to extract a short topic summary. Store the summary's embedding as a supplemental vector alongside the chunk's full-text embedding. At query time, search against both full-text and topic-summary vectors. When a topic summary matches, return the parent chunk.

```
Ingest:
  Chunk text ──→ Haiku ──→ Topic summary (50-100 tokens)
                              ↓
                         Embed summary ──→ Store as supplemental vector
                              ↓
                         Link to parent chunk ID

Query:
  Query embedding ──→ Search full-text vectors (existing)
                  ──→ Search topic-summary vectors (new)
                  ──→ Merge results (parent chunk dedup)
                  ──→ Existing pipeline (RRF, boost, rerank, etc.)
```

### 2.2 Ingest-Time Topic Extraction

**Prompt** (per chunk):

```
Extract a concise topic summary of this podcast transcript excerpt.
List ALL distinct topics discussed, including:
- The main film/show being discussed
- Any personal anecdotes, preferences, or lifestyle mentions by the hosts
- Any tangential topics, digressions, or asides
- Physical descriptions or characteristics mentioned about anyone
- Specific brands, products, or items mentioned
- Opinions, hot takes, or strong reactions

Format: A single paragraph, 2-4 sentences. Be specific — use names, brands, and details.
Do NOT editorialize or interpret — just describe what's discussed.

Transcript excerpt:
{chunk_text}
```

**Model**: Claude Haiku (claude-haiku-4-5-20251001) — fast, cheap, sufficient for extraction.

**Output example** for a Fast Times chunk containing a Haitch shorts aside:
> "Discussion of Fast Times at Ridgemont High focusing on Phoebe Cates' pool scene and the abortion subplot. Haitch mentions he owns chubbies shorts and prefers a 5-inch inseam. Jason compares Sean Penn's Spicoli performance to his other early roles."

**Batching**: Process chunks in parallel batches of 20 (Haiku handles high concurrency). Estimated ~5-6 minutes for 6,242 chunks at ~50ms/call with batching.

**Cost estimate**: ~6,242 chunks × ~600 input tokens × ~80 output tokens per chunk.
- Input: ~3.7M tokens × $0.80/MTok = ~$3.00
- Output: ~500K tokens × $4.00/MTok = ~$2.00
- **Total: ~$5 per full ingest run**

### 2.3 Storage Format

Topic summaries are stored in the existing vector store alongside full-text chunks. Each topic summary becomes a lightweight entry with its own embedding but pointing back to the parent chunk:

```typescript
interface StoredChunk {
  id: string;           // e.g., "episode_140_5" (regular) or "episode_140_5_topic" (topic summary)
  text: string;         // Full chunk text OR topic summary text
  embedding: number[];  // Embedding of full text OR embedding of topic summary
  metadata: {
    episodeTitle: string;
    speakers: string;
    startTimestamp: string;
    endTimestamp: string;
    parentChunkId?: string;  // NEW: set on topic-summary chunks, points to the full chunk
    chunkType?: string;      // NEW: 'topic_summary' for topic chunks, undefined for regular
  };
}
```

**Chunk ID convention**: `{parent_chunk_id}_topic` — e.g., `Fast_Times_at_Ridgemont_High__1982__5_topic`.

**Why not a separate index?** Storing topic summaries in the same vector store means the existing `searchSimilar()` function automatically searches both full-text and topic vectors. No changes to the embedding search path. Deduplication at the retrieval layer resolves parent chunks from topic hits.

### 2.4 Retrieval Changes

Minimal changes to `hybrid-retrieval.ts`:

1. **Topic-to-parent resolution**: After embedding search returns results, resolve any topic-summary chunks to their parent chunks. If both a parent and its topic summary appear in results, keep the higher score.

```typescript
function resolveTopicChunks(results: RetrievalResult[], chunkMap: Map<string, StoredChunk>): RetrievalResult[] {
  const parentScores = new Map<string, RetrievalResult>();

  for (const result of results) {
    const parentId = result.chunk.metadata.parentChunkId;
    const resolvedId = parentId || result.chunk.id;
    const resolvedChunk = parentId ? chunkMap.get(parentId) : result.chunk;

    if (!resolvedChunk) continue;

    const existing = parentScores.get(resolvedId);
    if (!existing || result.score > existing.score) {
      parentScores.set(resolvedId, {
        ...result,
        chunk: resolvedChunk,
      });
    }
  }

  return Array.from(parentScores.values()).sort((a, b) => b.score - a.score);
}
```

2. **Placement in pipeline**: Topic resolution runs immediately after embedding search, before RRF fusion. This ensures BM25 results (which only match full-text chunks) merge cleanly with resolved embedding results.

3. **BM25**: No changes. Topic summaries are not added to the BM25 index — they're short and would add noise to term frequencies. The value of topic extraction is in the *embedding* space, where the summary's vector is closer to personal/lifestyle queries than the full chunk's vector.

### 2.5 What This Doesn't Change

- **BM25 index**: Unchanged. Topic summaries not indexed for lexical search.
- **Supplemental query expansion**: Unchanged. Still generates 1-3 Haiku queries for persona/aggregation patterns.
- **Reranking**: Unchanged. Operates on resolved parent chunks.
- **Synthesis**: Unchanged. Receives full chunk text (not topic summaries).
- **Existing sub-chunks**: Personal asides (1000+), catchphrases (2000+), and segments (3000+) remain. They provide precise retrieval for known patterns. Topic extraction provides broad coverage for unknown patterns.
- **Agent search**: Unchanged. Agent routing decisions and grep-based search are unaffected.

---

## 3. Sizing

| Metric | Current | After Topic Extraction | Delta |
|--------|---------|----------------------|-------|
| Chunks in vector store | 6,242 | ~12,484 | +6,242 (~100%) |
| Vector store file size | ~234 MB | ~468 MB | +234 MB |
| Blob cold-start load time | ~2-3s | ~4-6s | +2-3s |
| BM25 index size | ~23 MB | ~23 MB (unchanged) | 0 |
| Ingest time (embedding) | ~3 min | ~6 min | +3 min |
| Ingest time (topic extraction) | 0 | ~5-6 min | +5-6 min |
| Ingest cost (embedding) | ~$0.10 | ~$0.20 | +$0.10 |
| Ingest cost (Haiku) | 0 | ~$5.00 | +$5.00 |
| Per-query embedding search time | ~50ms | ~100ms | +50ms |

### 3.1 Cold-Start Latency Concern

The vector store doubling to ~468 MB is the primary concern. Current cold-start loads 234 MB from Vercel Blob in ~2-3 seconds. Doubling to ~468 MB could push cold starts to ~4-6 seconds.

**Mitigations**:
- **Lazy loading**: Load topic vectors only when needed (separate blob file), trading cold-start for first-query latency.
- **Reduced embedding dimensions**: Topic summaries are short texts — could use a smaller embedding dimension if OpenAI supports it (text-embedding-3-small supports 512-dim via `dimensions` parameter, down from 1536). This would cut the topic vector size by ~67%, keeping total store at ~312 MB.
- **Compression**: Topic summary text is shorter than full chunk text — the text field contributes less to file size. The embedding vectors dominate.
- **Split storage**: Store topic embeddings in a separate blob file loaded in parallel. Fail open — if topic blob fails to load, retrieval falls back to full-text-only search (current behavior).

**Recommended approach**: Use 512-dim embeddings for topic summaries + split storage. This keeps the main vector store at 234 MB (no cold-start regression) and adds a ~78 MB topic-vector blob loaded in parallel.

---

## 4. Implementation Plan

### Step 1: Topic Extraction Function in `scripts/ingest.ts`

Add `extractTopicSummaries()` that takes all chunks for an episode and returns topic summary strings:

```typescript
async function extractTopicSummaries(
  chunks: Chunk[],
  batchSize: number = 20
): Promise<Map<string, string>> {
  // Returns Map<chunkId, topicSummary>
  // Batches Haiku calls for concurrency
  // Retries with backoff on rate limits
  // Returns empty map on failure (fail-open)
}
```

### Step 2: Store Topic Summaries

After topic extraction, create topic-summary `StoredChunk` entries with:
- ID: `{parentId}_topic`
- Text: the topic summary
- Embedding: generated alongside regular embeddings (but at 512-dim if using reduced dimensions)
- Metadata: same as parent + `parentChunkId` and `chunkType: 'topic_summary'`

### Step 3: Split Storage in `scripts/upload-search-data.ts`

Upload two blob files:
- `search-data/vector-store.json` — regular chunks only (unchanged size)
- `search-data/topic-vectors.json` — topic summary chunks only (~78 MB with 512-dim)

### Step 4: Parallel Loading in `src/lib/vectorstore.ts`

Load both blob files in parallel. If topic blob fails, log warning and continue with full-text-only search (fail-open).

### Step 5: Topic Resolution in `src/lib/hybrid-retrieval.ts`

Add `resolveTopicChunks()` after embedding search, before RRF fusion. Resolve topic hits to parent chunks, keeping the higher score when both appear.

### Step 6: Ingest Pipeline Integration

Wire topic extraction into the main ingest loop, after chunking and before embedding generation. Add `--skip-topics` CLI flag to bypass topic extraction (for quick re-ingests that don't need it).

---

## 5. Testing

### 5.1 Eval Cases

Add/update eval cases targeting the feedback cluster:

```json
{
  "name": "Personal lifestyle: Haitch shorts preference (FM-15 topic extraction)",
  "query": "What kind of shorts does Haitch like",
  "tags": ["factual", "personal", "FM-15", "topic-extraction"],
  "expectClassificationType": ["factual"],
  "expectTextInAnswer": ["chubbies", "shorts"],
  "expectMinTranscriptSources": 1,
  "rejectTextInAnswer": ["no information", "don't have"]
}
```

```json
{
  "name": "Personal lifestyle: Jason fishing (FM-15 topic extraction)",
  "query": "What does Jason think of fishing",
  "tags": ["interpretive", "personal", "FM-15", "topic-extraction"],
  "expectMinTranscriptSources": 2,
  "rejectTextInAnswer": ["no information", "don't have"]
}
```

```json
{
  "name": "Personal lifestyle: hosts physical descriptions (FM-15 topic extraction)",
  "query": "Describe what Jason and Haitch look like based on the podcast",
  "tags": ["interpretive", "personal", "FM-15", "topic-extraction"],
  "expectMinTranscriptSources": 2,
  "rejectTextInAnswer": ["no information", "don't have"]
}
```

These cases should **fail on current prod** (establishing the baseline) and **pass after topic extraction** ships.

### 5.2 Regression Testing

Run full eval suite (`npx tsx scripts/eval-search.ts`) before and after:
- **Acceptance**: All new `topic-extraction` tagged cases pass
- **Regression gate**: Zero regressions on existing 79 cases
- **Latency check**: p95 cold-start latency increase ≤ 3 seconds (measured via 5 sequential cold-start requests)

### 5.3 Topic Quality Spot-Check

Before full ingest, run topic extraction on a sample of 20 chunks and manually verify:
- Summaries mention all distinct topics in each chunk
- Personal/lifestyle asides are captured (not just the film discussion)
- No hallucinated topics (summary only contains what's actually in the chunk)
- Summaries are appropriately concise (2-4 sentences)

Sample should include:
- 5 chunks known to contain personal asides (from existing FM-15 test cases)
- 5 chunks from high-voicemailer episodes
- 5 chunks with no personal content (pure film discussion)
- 5 long chunks (>1000 tokens) with multiple topic shifts

### 5.4 Retrieval Quality Measurement

For each `topic-extraction` eval case, log whether the winning chunk was retrieved via:
- (a) full-text embedding match
- (b) topic-summary embedding match
- (c) BM25 match

This confirms topic extraction is the mechanism driving improvement, not incidental changes.

---

## 6. Rollback Plan

Topic extraction is designed to be fully reversible at every layer:

### 6.1 Immediate Rollback (< 1 minute)

If topic vectors cause retrieval quality regression or latency issues after deploy:

1. **Delete the topic-vectors blob**: `scripts/upload-search-data.ts --delete-topics` (or manual Vercel Blob dashboard deletion)
2. **Redeploy**: The vectorstore loader fails open — missing topic blob means retrieval falls back to full-text-only search automatically
3. No code changes needed. No data loss. Regular chunks are in a separate blob.

### 6.2 Code Rollback

If the feature needs to be removed entirely:

1. Revert the commits (topic extraction function, split storage, topic resolution in retrieval)
2. Re-upload original `vector-store.json` to blob (unchanged from pre-feature state since we use split storage)
3. No re-ingest needed

### 6.3 Partial Rollback

If topic extraction helps some queries but hurts others:

- Add a **topic vector discount factor** (analogous to the 0.7x supplemental query discount). Start at 1.0x, tune down to 0.5x or 0.3x if topic matches are too aggressive.
- Add a `TOPIC_VECTORS_ENABLED` feature flag (boolean env var, default `true`). When `false`, skip loading the topic blob entirely.

### 6.4 What Won't Need Re-Ingest

Because topic summaries are in a separate blob and regular chunks are unchanged:
- Disabling topics: no re-ingest
- Re-running topic extraction with a new prompt: only re-generate topic summaries + re-embed + re-upload topic blob (~10 min)
- Tuning topic discount factor: code change only, no re-ingest

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cold-start latency regression | Medium | Medium | Split storage + 512-dim embeddings. Fail-open loading. |
| Haiku hallucinating topics not in chunk | Low | Medium | Prompt instructs "do NOT editorialize." Spot-check 20 chunks before full run. |
| Topic summaries too generic (just restating the film title) | Medium | Low | Prompt emphasizes "personal anecdotes, digressions, specific brands." Iterate prompt on sample before full run. |
| False positive retrieval (topic summary matches but chunk isn't relevant) | Medium | Low | Topic resolution returns parent chunk; reranker filters irrelevant chunks downstream. Topic discount factor available as tuning lever. |
| Ingest cost ($5/run) adds up | Low | Low | Only re-run topic extraction when chunks change. `--skip-topics` flag for structural-only re-ingests. |
| 512-dim topic embeddings lose semantic precision | Low | Low | Topic summaries are short, high-signal text — 512 dims is likely sufficient. Can upgrade to 1536-dim if precision is an issue (at cost of larger blob). |

---

## 8. Future Extensions

If topic extraction proves effective:

- **Topic-aware BM25**: Index topic summaries in a separate lightweight BM25 index for lexical matching against extracted topics.
- **Selective extraction**: Only run topic extraction on chunks above a certain length or with detected topic shifts, reducing cost for short/focused chunks.
- **Topic clustering**: Aggregate topic summaries across episodes to build a "what topics does this podcast cover" index, enabling meta-queries like "which episodes mention fishing."
- **Replace category-specific sub-chunks**: If topic extraction reliably surfaces personal asides, catchphrase mentions, etc., the bespoke `extractPersonalAsides()` and `extractCatchphraseChunks()` could be deprecated in favor of the generic approach. (Segment sub-chunks would likely remain — they serve a different purpose of isolating voicemailer content by speaker.)

---

## 9. Decision Log

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Haiku for extraction | Cheapest model sufficient for summarization. ~$5/run vs ~$15 (Sonnet) or ~$75 (Opus). | Sonnet (better quality but 3x cost), regex heuristics (no LLM cost but misses nuanced topics) |
| Separate blob for topic vectors | No cold-start regression on main vector store. Fail-open loading. Clean rollback. | Single merged blob (simpler but doubles cold-start latency), database (overkill for this scale) |
| 512-dim topic embeddings | 67% size reduction with minimal quality loss for short texts. Keeps topic blob at ~78 MB. | 1536-dim (same as main vectors, larger blob), 256-dim (too aggressive reduction) |
| Topic resolution before RRF | BM25 only indexes full chunks, so resolution must happen before fusion to avoid double-counting. | Post-RRF resolution (simpler but risks score inflation from topic + parent both appearing) |
| Keep existing sub-chunks | Proven, precise retrieval for known patterns. Topic extraction is additive, not a replacement. | Remove sub-chunks (risky — topic extraction may not match their precision for known patterns) |

---

## 10. Review Questions and Implementation Comments

### 10.1 Data Model and Typing
- Question: should `StoredChunk` typing be formalized in a shared type with explicit `chunkType` enum (`standard`, `personal_aside`, `catchphrase`, `segment`, `topic_summary`) instead of free-form strings?
- Comment: adding a strict type now will reduce future retrieval bugs as chunk variants grow.
- **Response**: Yes. We'll add a `ChunkType` union type to `StoredChunk`. Existing sub-chunks don't currently carry a `chunkType` field — we'll backfill during the next ingest (`standard` as default, others inferred from ID offset ranges). This is a prerequisite for dimension-aware search (10.2).
- Question: do we need a `topicVersion` field in topic chunks to support prompt/model migrations without ambiguity?
- Comment: versioning enables side-by-side A/B on old vs new topic summaries and safer rollback.
- **Response**: Yes, lightweight. Store `topicVersion: 1` in topic chunk metadata. Bump on prompt or model changes. No A/B infrastructure needed yet — just a filter predicate if we need to invalidate old summaries during re-extraction.

### 10.2 Embedding Compatibility
- Question: if topic vectors use 512 dims and regular vectors use 1536 dims, where is dimension-aware search enforced so cosine comparisons never mix incompatible vectors?
- Comment: current design should explicitly split search paths by vector dimension and merge scores later; this needs a concrete implementation note in `vectorstore.ts`.
- **Response**: The split storage design (Section 3.1) naturally enforces this. Topic vectors live in a separate blob loaded into a separate in-memory array. `searchSimilar()` stays unchanged for the main store. A new `searchTopicVectors(queryEmbedding512, topicChunks, topK)` function handles the topic search path — it takes a 512-dim query embedding (generated via `dimensions: 512` parameter on the same text-embedding-3-small model). The two result sets merge via score, never via cosine comparison across dimensions. Implementation: `vectorstore.ts` gets `loadTopicVectorsAsync()` + `searchTopicVectors()` alongside existing functions.
- Question: do we want normalized score calibration between full-text and topic-only vector searches before merge?
- Comment: without calibration, one path may dominate due to distribution differences rather than relevance.
- **Response**: Good call. Cosine similarity distributions differ between 1536-dim and 512-dim, and between long chunk texts and short summaries. We'll apply min-max normalization within each result set before merging — map each set's scores to [0, 1] range, then combine. This also makes the topic discount factor (10.3) more meaningful since it operates on a normalized scale. If empirically the distributions are close enough, we can drop normalization later.

### 10.3 Retrieval Pipeline Placement
- Question: should topic-hit -> parent resolution occur before or after keyword/episode/speaker boosts?
- Comment: resolving early is correct for dedup, but we should preserve provenance (`matchedVia: topic|fulltext|both`) so downstream tuning can treat topic-origin matches differently if needed.
- **Response**: Resolve before RRF (as designed), but add a `matchedVia` field to `RetrievalResult`: `'fulltext' | 'topic' | 'both'`. Set during topic resolution — if a chunk appears in both full-text and topic results, mark as `'both'` and take the max normalized score. This provenance persists through the pipeline and gets logged in telemetry (10.7). Downstream boosts (keyword, speaker, episode) apply identically regardless of provenance — they're chunk-level signals, not retrieval-path signals.
- Question: should topic-origin hits get a discount factor (for example 0.7-0.9) by default to reduce false positives?
- Comment: this is likely needed initially and can be tuned with eval rather than introduced only as a rollback lever.
- **Response**: Agreed — ship with a default **0.85x topic discount factor** applied to topic-only hits before merging into the main result set. Chunks matched via both paths get no discount (the full-text match validates the topic match). Expose as `TOPIC_SCORE_DISCOUNT` constant in `hybrid-retrieval.ts` for easy tuning. Start conservative, tune up toward 1.0 if eval shows topic-only hits are high quality.

### 10.4 Ingest Reliability and Cost Control
- Question: what is the retry/backoff policy for Haiku extraction and embedding failures, and how do we avoid silently uploading partial topic blobs?
- Comment: require ingest summary counters (`totalChunks`, `topicSuccess`, `topicFail`, `topicSkipped`) and fail upload if failure rate exceeds a threshold.
- **Response**: Retry policy: 3 retries with exponential backoff (2s, 4s, 8s) per Haiku call, matching the existing embedding retry pattern. Ingest prints a summary: `Topic extraction: 6200 success, 42 failed, 0 skipped`. **Fail-safe gate**: if failure rate exceeds 5%, abort topic blob upload and print a warning — the regular vector store still uploads fine. This prevents shipping a partial topic index that would cause inconsistent retrieval behavior.
- Question: do we cache topic summaries by chunk content hash to avoid paying extraction cost on unchanged chunks?
- Comment: content-hash caching can cut repeated ingest cost/time dramatically.
- **Response**: Yes. Store a `topic-cache.json` alongside the other ingest artifacts: `{ [sha256(chunkText)]: topicSummary }`. On re-ingest, check cache first — only call Haiku for new/changed chunks. Cache invalidation: bump `topicVersion` when changing the extraction prompt (forces full re-extraction). Expected savings: most re-ingests only add new episodes (~10-20 chunks), so cache hit rate should be >95% after the initial run. Gitignore `topic-cache.json` (local artifact, not deployed).

### 10.5 Prompt and Extraction Quality
- Question: do we need structured output (JSON list of topics) instead of freeform 2-4 sentence paragraphs?
- Comment: structured output may improve consistency, dedup, and future explainability; prose summaries may drift in style and token usage.
- **Response**: Start with prose. The embedding vector is what matters for retrieval, and prose produces a denser semantic signal than a sparse keyword list. A JSON list like `["Fast Times", "chubbies shorts", "Phoebe Cates"]` embeds poorly — the tokens are disconnected. A sentence like "Haitch mentions he owns chubbies shorts and prefers a 5-inch inseam" embeds close to queries about shorts/clothing. If we later want structured metadata for filtering or explainability, we can extract that as a second pass without changing the embedding approach.
- Question: how will we prevent "topic inflation" where summaries include too many weak tangents that hurt precision?
- Comment: cap extracted topics or require confidence labels per topic if using structured format.
- **Response**: Two controls: (1) `max_tokens: 150` on the Haiku call — physically caps output to ~2-4 sentences, preventing runaway enumeration. (2) Prompt instruction "List only topics that occupy at least 2-3 lines of dialogue. Ignore single passing words." This filters one-word mentions that would add noise. We verify during the 20-chunk spot-check (Section 5.3) — if summaries are consistently inflated, tighten the prompt before full run.

### 10.6 Eval and Gating
- Question: should this ship behind a `topic-extraction` tag gate with required pass rate before global enable?
- Comment: yes, add a dedicated eval slice and enforce no regressions on non-topic cases.
- **Response**: Yes. Add `TOPIC_VECTORS_ENABLED` env var (default `false`). Enable in dev/staging first, run full eval. Gate: 100% pass on `topic-extraction` tagged cases + 0 regressions on existing cases. Then enable in prod. This is simpler than percentage rollout (10.10) since retrieval is deterministic — either the feature helps or it doesn't, no need for gradual traffic shifting.
- Question: should we add retrieval provenance assertions to eval ("at least one source came via topic vectors") for new FM-15 cases?
- Comment: this verifies the feature is doing real work, not passing incidentally.
- **Response**: Yes, but as a soft assertion (logged, not gating). Add `expectTopicVectorHit: true` to new FM-15 eval cases. The eval harness checks the `matchedVia` field in the API response's source metadata. If a topic-extraction case passes but without any topic-vector hits, it flags a warning — the case might be passing for the wrong reason and could regress if topic vectors are disabled.
- Question: should latency gates include both warm and cold starts separately?
- Comment: single p95 can hide cold-start regressions; track both distributions.
- **Response**: Yes. The eval harness already measures per-query latency. We'll add a cold-start measurement: first query after deploy (or after 10-minute idle) gets tagged `coldStart: true` in the query log. Acceptance criteria: cold-start p95 ≤ 8s (currently ~4-5s, so ~3s budget for topic blob loading). Warm p95 should be unchanged (topic blob is cached after first load).

### 10.7 Operational Observability
- Question: where will per-query topic usage metrics be logged (`topicHitCount`, `topicOnlyHitCount`, `topicBlobLoaded`)?
- Comment: extend `query-logger.ts` now so triage can confirm whether topic vectors were active and impactful.
- **Response**: Extend `QueryLogEntry` in `query-logger.ts` with: `topicBlobLoaded: boolean`, `topicHitCount: number` (chunks matched via topic path), `topicOnlyHitCount: number` (chunks matched *only* via topic, not full-text), `topicHitEpisodes: string[]` (which episodes the topic hits came from). These are cheap to compute during topic resolution and provide full triage visibility. The API response also includes `matchedVia` per source for client-side debugging.
- Question: do we alert when topic blob load fails repeatedly in production?
- Comment: fail-open is good for availability, but silent degradation will mask feature regressions without explicit monitoring.
- **Response**: Log `console.error` on topic blob load failure (already planned for fail-open path). Add a `topicBlobLoadError` field to the query log. For alerting: we don't currently have an alerting system, so the pragmatic approach is to check during weekly triage — if `topicBlobLoaded: false` appears in query logs, investigate. If we add alerting infrastructure later, this field is the trigger.

### 10.8 Interaction With Existing Features
- Question: what is the precedence order when topic vectors, supplemental queries, and reranker disagree?
- Comment: define explicit ordering and tuning ownership to avoid compounding heuristics.
- **Response**: The pipeline is sequential, not competing. Explicit order:
  1. **Embedding search** (full-text + topic vectors merged with normalization) → produces candidate set
  2. **BM25 search** (full-text only) → produces candidate set
  3. **RRF fusion** → merges embedding + BM25 candidates
  4. **Supplemental query merge** → adds supplemental hits at 0.7x discount
  5. **Boost pipeline** (keyword, speaker, episode) → adjusts scores
  6. **Reranker** → final ordering by semantic relevance

  Topic vectors affect step 1 only. Supplemental queries affect step 4 only. Reranker has final say. No interaction conflict — each operates at a different pipeline stage. A chunk surfaced by topic vectors but deemed irrelevant by the reranker gets dropped, same as any other chunk.
- Question: should topic summaries be generated for sub-chunks (`_1000+`, `_2000+`, `_3000+`) or only standard chunks?
- Comment: generating for all chunk types may over-amplify already high-signal sub-chunks and increase noise; default to standard chunks first.
- **Response**: Standard chunks only. Sub-chunks already have semantic prefixes (e.g., `[Recurring segment: Truthsayer / Birria voicemail]`) that serve the same purpose as a topic summary — they're short, focused, and embed close to relevant queries. Adding topic summaries on top would double their representation with no retrieval benefit. Filter in `extractTopicSummaries()`: skip chunks with ID offset ≥ 1000.

### 10.9 Security and Safety
- Question: do we need sanitization constraints in extraction prompt to avoid leaking malformed transcript content into topic summaries?
- Comment: probably low risk, but add minimal prompt guardrails and max output tokens to bound behavior.
- **Response**: Low risk — the transcripts are our own data (Whisper-transcribed podcast audio), not user-generated content. No prompt injection vector. Two guardrails already in place: (1) `max_tokens: 150` caps output length, (2) the prompt is descriptive-only ("describe what's discussed"), not generative. We won't add additional sanitization unless we see unexpected outputs in the 20-chunk spot-check.

### 10.10 Rollout Plan Tightening
- Question: should rollout be staged: 0% (shadow), 10%, 50%, 100% with explicit stop/go thresholds?
- Comment: staged rollout with kill switch is safer than immediate full enable, especially with doubled retrieval candidates.
- **Response**: Percentage rollout adds complexity for limited benefit here — retrieval is deterministic (same query + same data = same results), so 10% vs 100% doesn't surface different failure modes. Instead, a simpler staged approach:
  1. **Dev validation**: Run topic extraction on 20-chunk sample, spot-check quality. Run full ingest with topics. Run eval locally.
  2. **Shadow mode**: Deploy with `TOPIC_VECTORS_ENABLED=false`. Upload topic blob. Verify blob loads without errors in prod logs (test with a manual flag override via query param or header).
  3. **Enable**: Set `TOPIC_VECTORS_ENABLED=true`. Run full prod eval. Monitor query logs for 24 hours.
  4. **Stop/go thresholds**: Disable if (a) any gating eval case regresses, (b) cold-start p95 > 8s, or (c) `topicBlobLoadError` rate > 10%.

  Kill switch is just flipping the env var back to `false` — instant, no redeploy needed (env vars are hot-reloaded on Vercel).
