# Query Failure Modes

This document defines the most common ways search queries fail in the current architecture, including:
- query classes that are intrinsically hard with the current pipeline,
- predictable operational misses we should expect,
- where each failure originates (routing, retrieval, synthesis, metadata, or eval coverage).

It is intended to be used with:
- `docs/query-journey.md` (how the pipeline works),
- `docs/query-failure-triage.md` (how to triage incidents),
- `planv4.md` (how fixes are sequenced).

## How To Use This Document

For each reported bad query:
1. Find the nearest failure mode below.
2. Confirm stage-level root cause in triage.
3. Add or update an eval case for that mode.
4. Map remediation to the corresponding `planv4` phase.

## Failure Mode Taxonomy

### FM-01: Intent/Classification Misroute
- Stage: Routing
- Query type: ambiguous factual vs interpretive/hybrid
- Why hard now: short or overloaded phrasing can look metadata-answerable while actually requiring transcript evidence.
- Common miss: query sent to metadata fast-path, returns thin or wrong answer.
- User-visible symptom: confident but incomplete answer, or irrelevant metadata list.
- Plan alignment: Phase 1 (routing guardrails), Phase 4 (routing assertions).
- Phase 1 mitigations shipped:
  - Medium-confidence intents skip metadata fast-path, fall through to full pipeline.
  - Low-confidence classifications (< 0.6) with no filters force hybrid handling.
  - Quick synthesis restricted to factual queries without `requiresTranscriptDepth`.

### FM-02: Endpoint Drift (`/api/search` vs `/api/search/stream`) — MITIGATED
- Stage: Routing/Policy
- Query type: any
- ~~Why hard now: duplicated logic can diverge subtly over time.~~
- Common miss: same query yields different routing, depth, or result quality by endpoint.
- User-visible symptom: UI answer differs from non-stream API answer.
- Plan alignment: Phase 1 (shared policy), Phase 4 (endpoint parity assertions).
- Phase 1 resolution: shared routing policy module (`src/lib/routing-policy.ts`) centralizes all routing decisions (`shouldSkipMetadataAggregate`, `shouldForceHybridClassification`, `shouldUseQuickSynthesis`, constants, `episodeToMetadataSource`). Both endpoints import from this module. Presentation-layer duplication (Tilda/notable-moments formatting) remains but is expected (JSON vs SSE).
- Residual risk: future changes could re-introduce drift if new routing logic is added inline instead of via the shared module. Phase 4 endpoint parity assertions will guard against this.

### FM-03: Filter Extraction Failure
- Stage: Classification -> Metadata retrieval
- Query type: factual/hybrid with entities (film/guest/director/genre)
- Why hard now: extraction errors or generic token extraction can overconstrain/underconstrain search.
- Common miss: no metadata matches, wrong film/person picked, fallback too broad.
- ~~Example: episode-id lookup misses such as “what episode is 283” or “give me details about episode 283”.~~ **Resolved in Phase 1** — dedicated `metadata_episode_lookup` intent now handles these patterns deterministically.
- User-visible symptom: “no matches” where known matches exist, or wrong episode set.
- Plan alignment: Phase 2 (relaxation strategy), Phase 5 (canonicalization + matching tiers), Phase 4 tests.

### FM-04: Sparse Retrieval Miss for Transcript-Depth Factual Queries — PARTIALLY MITIGATED
- Stage: Retrieval
- Query type: phrase lookup, quote lookup, biography-like host questions, frequency/ranking queries
- Why hard now: top-K chunk retrieval may not include the decisive evidence.
- Common miss: synthesis concludes “not found” despite evidence elsewhere in corpus.
- User-visible symptom: false negative on known in-transcript facts.
- Plan alignment: Phase 2a (context expansion, dedup), Phase 2b (rerank), Phase 2c (remaining), Phase 4 recall assertions.
- Phase 2a mitigations shipped:
  - `expandAdjacentChunks()` appends ±1 neighbor chunks for keyword-matching results at 0.5× parent score. Fixes cases where the entity mention and the connected anecdote are in adjacent chunks (e.g., Joe Eszterhas).
  - `deduplicateChunks()` removes near-duplicate chunks (Jaccard ≥ 0.6), freeing slots for diverse evidence.
  - `suppressBoilerplate()` downranks outro/credits chunks, promoting substantive content.
- Phase 2b mitigations shipped:
  - `rerankChunks()` — LLM reranking via Haiku reorders top-N chunks by semantic relevance, catching cases where lexical/embedding scores don't reflect actual query match quality. Skipped for ≤5 results; 5s timeout fallback.
- Residual risk: anecdotes spanning >2 chunks or cases where entity mention is far from the evidence. Paraphrased re-broadcast duplicates below Jaccard 0.6 still consume slots.

### FM-05: Windowed Frequency Comparison Failure
- Stage: Retrieval/Analysis
- Query type: “first N vs last N”, “who says X more”, phrase counts across explicit windows
- Why hard now: these are counting tasks; sampling/ranked retrieval is not a reliable counting substrate.
- Common miss: one window underrepresented, wrong winner, or false zero in recent/older windows.
- User-visible symptom: incorrect comparative claim (“none in last 100”).
- Plan alignment: Phase 2 (deterministic window analysis), Phase 4 gold-count assertions.

### FM-06: Cross-Episode Aggregation Failure — PARTIALLY MITIGATED
- Stage: Retrieval + Synthesis
- Query type: trait/persona summaries and “what do we know about X and Y”
- Why hard now: evidence is distributed across episodes and may not co-occur in a single chunk.
- Common miss: answer says “no information” despite scattered supporting evidence.
- User-visible symptom: flat denial where partial/qualified synthesis was possible.
- Plan alignment: Phase 2a (dedup frees episode slots), Phase 2b (entity-aware retrieval), Phase 3 (aggregation policy), Phase 4 assertions.
- Phase 2a mitigations shipped: dedup removes near-duplicate chunks that inflate per-episode counts, freeing slots for more diverse episodes. Boilerplate suppression prevents outro chunks from consuming episode slots.

### FM-07: Role Attribution Error (Host vs Guest vs Voicemailer)
- Stage: Synthesis (with retrieval contributors)
- Query type: person-scoped prompts ("Did Haitch...", "What did Corey...")
- Why hard now: chunks often contain multiple speakers; role constraints are weak.
- Common miss: guest quote attributed to host, or vice versa.
- User-visible symptom: wrong person credited for claim.
- Plan alignment: Phase 3 (role-aware attribution), Phase 4 role assertions.

### FM-08: Episode Attribution Error
- Stage: Synthesis
- Query type: "what episode", citation-heavy factual responses
- Why hard now: synthesis can blend details from separate chunks/episodes.
- Common miss: details from episode A labeled as episode B.
- User-visible symptom: wrong episode cited for a true quote/detail.
- Plan alignment: Phase 3 attribution integrity checks, Phase 4 attribution assertions.

### FM-09: Medium Contamination (Film vs TV)
- Stage: Retrieval + Synthesis
- Query type: TV-only or film-only queries
- Why hard now: lexical overlap plus weak medium constraints.
- Common miss: TV query returns film evidence (or inverse) unless user is very explicit.
- User-visible symptom: off-target recommendations/examples.
- Plan alignment: Phase 2 medium-aware retrieval, Phase 4 medium assertions.

### FM-10: Boilerplate/Outro Dominance — MITIGATED
- Stage: Retrieval
- Query type: lexical phrase queries, trait/persona queries
- ~~Why hard now: recurring credits/outro text can dominate lexical matches.~~
- Common miss: high-ranked chunks are repetitive boilerplate, not semantic evidence.
- User-visible symptom: answer anchored on repetitive show boilerplate.
- Plan alignment: Phase 2a boilerplate suppression, Phase 4 noise-focused assertions.
- Phase 2a resolution: `suppressBoilerplate()` matches 6 regex patterns for recurring outro/credits language. 2+ pattern matches → 0.3× score penalty; 1 match → 0.6× penalty. Chunks are not removed (still findable if directly queried), just downranked.
- Residual risk: boilerplate with novel phrasing not covered by the 6 patterns could still rank highly.

### FM-11: Weak-Evidence Overclaim
- Stage: Synthesis
- Query type: favorites, strongest opinions, comparative judgments
- Why hard now: model pressure to answer definitively even with sparse evidence.
- Common miss: “favorite/all-time” claim based on one mention.
- User-visible symptom: overconfident preference claim.
- Plan alignment: Phase 3 evidence-threshold policy, Phase 4 preference assertions.

### FM-12: Fast-Path Dead-End or Thin Fallback
- Stage: Routing/Fallback
- Query type: metadata-intent queries with partial mismatches
- Why hard now: fast-path may trigger without robust fallback rationale.
- Common miss: terse unhelpful output instead of fallback full pipeline + explanation.
- ~~Example: explicit episode-number questions fail to return metadata details and instead degrade into weak transcript-only responses.~~ **Resolved in Phase 1** — `metadata_episode_lookup` intent returns a deterministic summary; falls through to full pipeline when episode not found.
- User-visible symptom: abrupt “no result” or low-context answer.
- Plan alignment: Phase 1 fast-path fallthrough guardrails, Phase 4 routing assertions.
- Phase 1 mitigations shipped: medium-confidence intents bypass fast-path entirely; all fast-path misses log structured reason and fall through.

### FM-13: Ambiguous Term Scope Narrowing in Synthesis
- Stage: Synthesis
- Query type: single-word or short queries where the term has multiple referents across transcripts (person name, franchise, character, etc.)
- Why hard now: synthesis model latches onto the most "obvious" interpretation (e.g., Zelda = video game) and ignores other valid referents (e.g., Zelda Rubinstein the actress, Madame Zelda story) even when evidence for those referents is present in the provided sources.
- Common miss: answer discusses only one interpretation despite sources containing multiple distinct referents; concludes with false denial about other referents.
- User-visible symptom: answer feels incomplete — user knows the term appears in more contexts than the answer covers.
- Example: query "Zelda" — retrieval finds 4 episodes with mentions (video game, Zelda Rubinstein actress, Madame Zelda Nathan Lane story, Zelda character in Southland Tales) but synthesis only discusses the video game reference and says "I don't have information about any Legend of Zelda films."
- Plan alignment: Phase 3 (synthesis grounding checks — require synthesis to address all distinct referent clusters in provided sources), Phase 4 (multi-referent assertions).

## Query Classes That Are Intrinsically Hard In Current Architecture

These are expected to be hard until dedicated handling is added:
- Deterministic counting/comparison tasks across explicit windows or full corpus.
- Multi-entity, multi-clause factual prompts where evidence is split across distant chunks/episodes.
- Person-scoped attribution questions in transcripts with dense multi-speaker exchanges.
- Ranking-style prompts (“most often”, “top 5 times”, “strongest preference over time”) requiring exhaustive or near-exhaustive evidence.
- Queries needing negative proof (“never said X”, “no episodes with Y”) without full-scan safeguards.

## Common Miss Patterns We Should Expect

- False negatives from insufficient retrieval coverage.
- Right evidence, wrong person attribution.
- Right quote, wrong episode attribution.
- Correct intent, wrong depth mode. *(Partially mitigated: quick synthesis now gated on `requiresTranscriptDepth`.)*
- Correct metadata filter domain, wrong extracted value.
- Overconfident summary language when evidence is sparse.
- ~~Endpoint-specific inconsistencies.~~ *(Mitigated by shared routing policy module.)*

## Detection Signals (Operational)

Track these signals to detect failure modes early:
- High disagreement rate between `/api/search` and `/api/search/stream` for same query. *(Should now be rare given shared routing policy; monitor for regression.)*
- High rate of “no information” for queries later verified as answerable.
- Elevated citation-episode mismatch rate.
- Elevated host/guest attribution correction rate in user feedback.
- Repeated boilerplate chunks in top retrieved evidence.
- Large variance in outputs for repeated runs of the same deterministic-style query.

## Test Planning Requirements By Mode

Each failure mode should have at least one eval case with:
- Positive assertion: what must appear.
- Negative assertion: what must not appear.
- Attribution assertion: person/episode accuracy where relevant.
- Endpoint parity assertion: same winner/claim across both endpoints.
- Uncertainty assertion: requires qualified wording when evidence is partial.

## Sequencing Guidance (Holistic, Not One-Off)

Apply fixes in this order:
1. Routing consistency and fallthrough guarantees (Phase 1).
2. Retrieval coverage and deterministic analyzers for counting/window classes (Phase 2).
3. Synthesis guardrails for attribution and evidence-threshold language (Phase 3).
4. Eval + CI gates that lock in behavior and prevent regressions (Phase 4).
5. Metadata canonicalization and refresh reliability (Phase 5).

Do not ship a one-off fix unless:
- it maps to a named failure mode above,
- a reusable policy/change is identified,
- and a regression test is added for the entire class.
