# Transcript Search Limitations Plan

## Purpose
Document the current limitations in transcript search and a proposed approach to address each one before implementation.

## Scope
Search pipeline: query classification, metadata retrieval, transcript retrieval, answer synthesis, and UX feedback.

## Limitations and Proposed Approaches

### 1) Heuristic query classification can misroute factual queries
**Observed:** Keyword triggers default to interpretive unless strongly factual.  
**Proposed approach:**  
- Add explicit factual intent detection via lightweight LLM classification with calibrated confidence.
- Keep heuristics, but fall back to LLM when confidence is low or query is short/ambiguous.
- Log classification outcomes for offline tuning.

### 2) Factual/hybrid filters rely on LLM extraction; failures degrade metadata recall
**Observed:** If extraction fails, filters are weak or missing.  
**Proposed approach:**  
- Add deterministic fallbacks (regex for episode numbers, guest names from known list).
- Maintain a canonical entity list derived from `data/episode-metadata.json`.
- Capture LLM parsing errors and return diagnostic metadata in debug mode.

### 3) Transcript retrieval is pure embedding top‑K (no lexical match or rerank)
**Observed:** Rare/precise terms can be missed.
**Proposed approach:**
- Add a lexical search path (simple BM25) alongside embeddings. ✅ DONE
- Merge results and apply a lightweight reranker (cross‑encoder or LLM scoring). ✅ DONE (RRF)
- Evaluate recall on a small test set of known queries.

### 4) Fixed top‑K (10) transcript chunks can miss relevant context
**Observed:** Single batch of 10 chunks limits recall.
**Proposed approach:**
- Make K adaptive (based on query type and confidence). ✅ DONE
- Add a second‑pass retrieval if answer confidence is low.
- Optionally include neighboring chunks to preserve local context.

### 5) Metadata queries return first 20 episodes if no filters
**Observed:** “All episodes” silently truncates to 20.  
**Proposed approach:**  
- Add pagination (limit/offset or cursor) to metadata retrieval.
- Sort results deterministically (by release date or episode number).
- Expose total counts in API responses.

### 6) Vector store is bundled at build time and can be stale
**Observed:** `vector-data.ts` is static; needs rebuild to update.  
**Proposed approach:**  
- Document the ingest/rebuild workflow in the repo.
- Add an admin endpoint or script to rebuild and redeploy.
- Consider server‑side dynamic loading from a data store when feasible.

### 7) Answer length is capped (1024 tokens)
**Observed:** Longer, comprehensive answers can truncate.  
**Proposed approach:**  
- Add a “long answer” mode with higher max tokens for certain queries.
- Support summarization across batches when results are large.
- Provide concise vs detailed response toggles in UI.

### 8) Hallucination risk; weak source grounding
**Observed:** Prompts request grounding but no strict enforcement.  
**Proposed approach:**  
- Enforce explicit citation of sources used in the answer.
- Add a refusal/uncertainty threshold when retrieval confidence is low.
- Provide links to episode/timestamp references in UI.

### 9) Transcription accuracy for rare/proper nouns
**Observed:** AssemblyAI requests do not provide custom vocabulary/boosting, so uncommon names/titles are often misheard.  
**Proposed approach:**  
- Add `word_boost`, `boost_param`, and `custom_spelling` to the AssemblyAI payloads.  
- Optionally supply `keyterms_prompt` for larger domain vocab.  
- Generate a lexicon from existing transcripts + metadata, then review and curate.

### 10) Transcript review UX is slow for speaker assignment
**Observed:** Hard to isolate segments, no quick undo, and batch operations are limited.
**Proposed approach:**
- Add undo/redo for bulk edits (last action).
- Add "solo/lock speaker" modes and multi‑select with keyboard shortcuts.
- Provide filters (speaker, confidence, duration) and "next unassigned" navigation.
- Add bulk apply on contiguous segments and quick assign via number keys.

### 11) No crew/cast metadata for director, cinematographer, actor queries
**Observed:** Queries like "Tim Burton movies" or "Roger Deakins cinematography" fail because metadata only has film title, not crew info. System either returns 0 results or hallucinates.
**Proposed approach:**
- Integrate TMDB (The Movie Database) API to augment episode metadata with crew/cast data.
- Build a one-time enrichment script that:
  - Matches each episode's film title to TMDB
  - Fetches director, cinematographer, key cast, genre, and other relevant fields
  - Stores enriched data in `episode-metadata.json` or a separate lookup table
- Add new query filters: `director`, `cinematographer`, `actor`, `genre`
- Update query classifier to recognize crew-related queries and extract appropriate filters
- Handle TMDB API rate limits and caching for build-time enrichment
- Consider periodic refresh to catch metadata corrections

**TMDB fields to capture:**
- Director(s)
- Cinematographer (Director of Photography)
- Key cast (top 5-10 actors)
- Genre(s)
- Runtime
- TMDB ID (for future lookups)
- Poster URL (optional, for UI enhancement)

## Implementation Plan (Phased)

### Phase 1: Reliability and Coverage
- Add metadata pagination and sorting. ✅ DONE
- Improve query classification with LLM fallback + logging. ✅ DONE
- Expand retrieval to include lexical search and adaptive K. ✅ DONE
- Add AssemblyAI vocab boosting fields + curated lexicon support. ✅ DONE
- Integrate TMDB for crew/cast metadata enrichment.

### Phase 2: Answer Quality
- Add reranking and source‑grounded response requirements. ✅ DONE (grounding rules added)
- Implement long‑answer mode and batch summarization.
- Improve transcript review UX (undo/redo, filters, fast assignment). ✅ DONE

### Phase 3: Operational Robustness
- Formalize ingest/rebuild workflow and automation.
- Consider dynamic vector store loading (or external vector DB).

## Post‑Merge Gap Fix Plan (Current Codebase)

### Gap A) `/api/search` still uses legacy embedding‑only path
**Observed:** Non‑stream route uses `hybrid-search.ts` (embedding‑only, sync load, no BM25/adaptive K, no unfiltered guard).  
**Proposed approach:**  
- Route `/api/search` through `hybrid-retrieval.ts` + streaming synthesis logic parity.
- Ensure unfiltered‑factual guard matches `/api/search/stream`.
- Remove or refactor `hybrid-search.ts` to avoid drift.

### Gap B) “No data” messaging is outdated after TMDB integration
**Observed:** Responses still claim no director/actor/genre support.  
**Proposed approach:**  
- Update messaging in `src/app/api/search/stream/route.ts` and `src/lib/claude.ts`.
- Ensure fallback messages list the current, accurate filter set.

### Gap C) Pagination in search API is incomplete
**Observed:** `queryEpisodes` supports pagination, but `/api/search/stream` hard‑caps to 500 and has no pagination params.  
**Proposed approach:**  
- Add `limit`/`offset` (or cursor) to search request payload.
- Return totalCount/hasMore in response and surface it in UI.
- Add guardrails to prevent unbounded payloads.

### Gap D) Answer length cap remains fixed
**Observed:** 1024 token max, no long‑answer mode.  
**Proposed approach:**  
- Add query‑type‑based max_tokens (or a user toggle).
- Add batch summarization when retrieval returns many items.

### Gap E) AssemblyAI boosting only in API; CLI path missing
**Observed:** `scripts/transcribe.ts` doesn’t use `word_boost` or `custom_spelling`.  
**Proposed approach:**  
- Reuse `getWordBoostList()` and `getCustomSpellings()` in CLI transcription.
- Add a CLI flag to cap max terms and disable boosts if desired.

### Gap F) Review editor lacks bulk/undo tools
**Observed:** The new mapping UI has advanced tools, but the editor view doesn’t.  
**Proposed approach:**  
- Add bulk speaker reassignment and undo/redo in `TranscriptEditor`.
- Add multi‑select + keyboard shortcuts for quick assignment.

## Gap Fix Sequencing
- Phase 1: A, B, C (search parity + correctness)
- Phase 2: D, E (quality + transcription)
- Phase 3: F (editor productivity)

## Concrete Checklist (By Gap)

### Gap A) `/api/search` legacy path
- [ ] Replace `src/app/api/search/route.ts` to use `hybrid-retrieval.ts` (BM25 + adaptive K).
- [ ] Align metadata filtering + unfiltered‑factual guard with `/api/search/stream`.
- [ ] Return `totalCount/hasMore` in JSON response for metadata.
- [ ] Deprecate or refactor `src/lib/hybrid-search.ts` to avoid drift.
- [ ] Add tests or sample queries to verify parity between streaming and non‑stream responses.

### Gap B) Outdated “no data” messaging
- [ ] Update warning message in `src/app/api/search/stream/route.ts`.
- [ ] Update fallback copy in `src/lib/claude.ts` to list current supported filters.
- [ ] Verify that messages do not mention removed limitations.

### Gap C) Pagination missing in search API
- [ ] Add `limit` and `offset` to `/api/search` and `/api/search/stream` request bodies.
- [ ] Wire pagination args through to `queryEpisodes`.
- [ ] Include `totalCount`, `returnedCount`, and `hasMore` in response payload.
- [ ] Add UI affordance to request the next page (optional but recommended).
- [ ] Enforce max limits to avoid large payloads (e.g., cap 500).

### Gap D) Answer length cap
- [ ] Add per‑query max_tokens (factual/hybrid higher than interpretive).
- [ ] Add “long answer” toggle in UI (or auto‑enable when metadata count > threshold).
- [ ] If large result sets, summarize in batches and append a compact list of episodes.

### Gap E) AssemblyAI boosting only in API
- [ ] Update `scripts/transcribe.ts` to include `word_boost` and `boost_param`.
- [ ] Apply `getCustomSpellings()` where supported.
- [ ] Add CLI flags for boost size and disable/enable lexicon.
- [ ] Document the lexicon workflow (generate → review → use).

### Gap F) Review editor tooling
- [ ] Add bulk speaker reassignment in `TranscriptEditor`.
- [ ] Add undo/redo history for speaker edits.
- [ ] Add multi‑select for segments + keyboard shortcuts for assign.
- [ ] Add “next unassigned” navigation in editor view.

### UX Notes (Speaker Review on `/review/new`)
- [ ] Double‑click a dialogue segment to isolate it and apply speaker assignment only to that segment.
- [ ] If a diarized speaker label has < 10 segments, clicking the label should auto‑filter the view to only that speaker’s utterances for quick verification.
## Open Questions
- What’s the target latency budget for hybrid retrieval + reranking?
- How much infrastructure change is acceptable (local store vs external DB)?
- Should we expose confidence scores to users?

## Success Criteria
- Higher recall on benchmark queries (define a test set).
- Fewer misrouted factual queries (tracked via logs).
- More complete metadata responses (no silent truncation).
