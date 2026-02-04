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

## Open Questions
- What’s the target latency budget for hybrid retrieval + reranking?
- How much infrastructure change is acceptable (local store vs external DB)?
- Should we expose confidence scores to users?

## Success Criteria
- Higher recall on benchmark queries (define a test set).
- Fewer misrouted factual queries (tracked via logs).
- More complete metadata responses (no silent truncation).
