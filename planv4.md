# Plan v4: Search Quality Roadmap

## v3 -> v4 Delta (What Changed)
- Reframed from historical status log to forward-only execution plan.
- Removed completed-item narrative and date-stamped implementation notes.
- Added explicit phase exit criteria so each phase has a clear ship gate.
- Added quantitative success metrics as first-class targets (quality, routing, latency, reliability).
- Elevated endpoint consistency (`/api/search` vs `/api/search/stream`) to Phase 1 priority.
- Separated retrieval improvements from synthesis-policy work to reduce scope coupling.
- Added CI quality-gate requirements and weekly triage reporting as core deliverables.
- Added a formal definition of done tied to sustained post-launch stability.
- Added anecdote-linkage safeguards for multi-clause factual queries (entity + event + episode).

## Purpose
Create a clean, execution-ready roadmap to improve search quality, reliability, and observability without carrying historical implementation notes.

## North Star
Users get accurate, well-grounded answers quickly, with predictable behavior across query types and clear signals when the system is uncertain.

## Success Metrics
- Retrieval quality:
  - +20% MRR on the eval set vs current baseline.
  - +15% Recall@10 on transcript-dependent queries.
- Routing quality:
  - <5% metadata-answerable queries miss metadata fast-path.
  - <5% interpretive/transcript-depth queries get shallow synthesis.
- Answer quality:
  - +15% pass rate on eval assertions.
  - -30% user thumbs-down rate on search results.
- Performance:
  - p95 end-to-end latency <= 8s for quick mode.
  - p95 deep mode latency <= 20s.
- Reliability:
  - 0 silent dead-ends (all failed fast-paths fall through or return explicit rationale).

## Scope
- `/api/search` and `/api/search/stream` routing consistency.
- Intent detection and query classification.
- Metadata retrieval and transcript retrieval.
- Synthesis mode policy (quick vs full-depth).
- Evaluation harness, telemetry, and feedback loop.
- Metadata quality and refresh lifecycle.

## Non-Goals
- Full UI redesign.
- New data domains outside podcast metadata/transcripts.
- Replacing Anthropic models end-to-end.

## Design Principles
- Correctness over cleverness.
- Deterministic behavior where possible.
- Explicit fallbacks over hidden failures.
- Measurable changes only (every phase ships metrics).
- Single source of truth for routing and synthesis policy.

## Current Gaps (to address)
- ~~Routing behavior diverges between streaming and non-streaming paths.~~ **Resolved in Phase 1** — shared routing policy module (`src/lib/routing-policy.ts`) unifies all routing decisions.
- ~~Confidence signals are not fully calibrated.~~ **Partially resolved in Phase 1** — medium-confidence intents skip metadata aggregate; low-confidence classifications force hybrid; `classificationConfidence` exposed in API response.
- ~~Retrieval still allows noisy/duplicative chunks in difficult queries.~~ **Partially resolved in Phase 2a** — boilerplate suppression, Jaccard dedup, and adjacent-chunk expansion shipped. Paraphrased re-broadcast duplicates (below Jaccard 0.6) remain.
- Filter relaxation is limited and not standardized.
- Quality improvements are not consistently gated in CI with quantitative metrics.
- Metadata matching is still too substring-heavy in places.
- Phrase-frequency comparisons over explicit episode windows (for example, "first 100 vs last 100") are non-deterministic and can miss true positives in recent windows.

## Roadmap

### Phase 1: Routing Consistency and Guardrails ✅ SHIPPED
Objective: eliminate logic drift and remove high-cost misroutes.

Implementation:
- ✅ Unified routing/synthesis policy between `/api/search` and `/api/search/stream` via shared module `src/lib/routing-policy.ts`.
- ✅ Centralized `shouldUseQuickSynthesis()` — checks `depth === 'quick' && type === 'factual' && !requiresTranscriptDepth`.
- ✅ Centralized `shouldSkipMetadataAggregate()` — skips metadata fast-path for medium-confidence intents.
- ✅ Centralized `shouldForceHybridClassification()` — forces hybrid when confidence < 0.6 and no filters.
- ✅ Centralized `episodeToMetadataSource()` — eliminated ~100 lines of duplication across both endpoints.
- ✅ Extracted constants: `MAX_LIMIT`, `DEFAULT_LIMIT`, `QUICK_SYNTHESIS`, `DEEP_SYNTHESIS_MODEL`.
- ✅ Added `metadata_episode_lookup` intent in `query-intent.ts`:
  - supports patterns: `what episode is 283`, `episode 204` (bare), `tell me about episode 150`.
  - returns deterministic metadata summary (title, season/episode, release date, guest/reviewer).
  - falls through to full pipeline when episode not found.
- ✅ Enforced transcript-depth parity:
  - factual queries with `requiresTranscriptDepth=true` use full synthesis on both endpoints.
  - quick-mode truncation only for metadata-answerable factual queries.
- ✅ Enforced confidence-based routing policy:
  - high-confidence metadata intents: fast-path.
  - medium-confidence metadata intents: skip fast-path, fall through to full pipeline.
  - low classification confidence with empty filters: force hybrid handling.
- ✅ All fast-path misses fall through with structured reason logging.
- ✅ Added `classificationConfidence` to regular endpoint response (was already in stream).
- ✅ Fixed `synthesistuning` typo in stream endpoint → `synthesisTuning`.

Verification:
- `npm run regression:routing` — 10/10 routing policy unit tests pass.
- `npm run regression:queries` — 20/20 intent regression cases pass (17 existing + 3 new episode-lookup).
- TypeScript compilation clean on all changed files.

Remaining (deferred to Phase 2+):
- Tilda/notable-moments fast-path handlers still have presentation-layer duplication (endpoints format differently for JSON vs SSE).
- `metadata-aggregates.ts` retains its own internal `episodeToMetadataSource` copy to avoid circular dependency risk.

### Phase 2a: Retrieval Quality — High-Impact Trio ✅ SHIPPED
Objective: fix the two real retrieval failures from Phase 1 eval (Joe Eszterhas anecdote linkage, digital court jew episode attribution) with three retrieval-layer improvements.

Implementation:
- ✅ `suppressBoilerplate()` in `hybrid-retrieval.ts` — 6 regex patterns for recurring outro/credits; 2+ matches → 0.3× score, 1 match → 0.6× score.
- ✅ `deduplicateChunks()` in `hybrid-retrieval.ts` — Jaccard similarity (≥0.6 threshold) on lowercased token sets removes near-duplicate chunks (e.g., Best-of re-broadcasts).
- ✅ `parseChunkId()` + `expandAdjacentChunks()` in `hybrid-retrieval.ts` — appends ±1 neighbor chunks at 0.5× parent score for keyword-matching results.
- ✅ `getChunkMap()` in `vectorstore.ts` — lazily-built `Map<string, StoredChunk>` for O(1) neighbor lookups, cached at module level.
- ✅ Pipeline updated: `RRF → keyword boost → episode boost → boilerplate suppress → dedup → diversify → context expand`.
- ✅ 20 unit tests added to `scripts/regression-retrieval.ts`; `regression:retrieval` npm script added.
- ✅ Eval throttling + retry with backoff added to `scripts/eval-search.ts` (2s delay between cases, up to 3 retries with 10s/20s/40s backoff on 429s).

Verification:
- `npm run regression:retrieval` — 20/20 unit tests + 19/19 integration tests pass.
- `npm run regression:queries` — 20/20 (no routing regressions).
- `npm run regression:routing` — 10/10 (no routing regressions).
- Eval: 45/52 → 50/52 (+6 improved, 1 borderline regression).
  - Joe Eszterhas anecdote linkage: **fixed** (context expansion surfaces adjacent chunk).
  - Digital court jew: improved (11 → 10 episodes) but still above ≤2 target.
  - Haitch band history: borderline regression — answer is correct but synthesis phrasing triggers assertion.

### Phase 2b: Retrieval Quality — Remaining Upgrades (2-3 weeks)
Objective: address remaining retrieval gaps not covered by Phase 2a.

Deliverables:
- Add post-retrieval reranking (lightweight cross-encoder or compact LLM reranker) on top-N fused chunks.
- Further dedup improvements for digital court jew case (Best-of re-broadcasts use paraphrased language below Jaccard 0.6).
- Add deterministic transcript analysis for explicit windowed phrase-frequency queries:
  - detect patterns like quoted phrase + `first N episodes` + `last N episodes` (+ optional speaker constraint).
  - compute counts by scanning transcripts in the requested windows, not by sparse top-K retrieval.
  - return transcript coverage for each window (found vs expected transcripts) and conservative wording when coverage is incomplete.
  - run via shared module used by both search endpoints.
- Add medium-aware retrieval constraints for film vs TV intent:
  - preserve short but high-signal tokens (e.g., "tv") in query-term handling.
  - add normalization/synonym expansion for TV terms ("tv", "television", "series", "show").
  - reduce cross-medium bleed (TV query returning film-only evidence unless explicitly mixed).
- Add entity-aware retrieval mode for person-centric questions:
  - support speaker/entity constraints (e.g., "Corey", hosts, guests, voicemailers) as first-class retrieval signals.
  - prioritize chunks where entity mention and target concept co-occur within a bounded window.
  - add token normalization for possessives/plurals (e.g., "Corey's", "whips" -> "Corey", "whip").
- Generalize filter relaxation strategy:
  - full filters
  - relaxed secondary filters
  - return rationale + closest matches when relaxation is used
- Strengthen metadata-informed transcript boosting with safeguards for broad queries.

Exit Criteria:
- MRR and Recall@10 improvements hit phase target on eval subsets.
- Repetition rate in generated answers decreases measurably.
- TV-vs-film constrained queries show <10% cross-medium contamination on eval slices.
- Person-centric concept queries improve Recall@10 by >=20% on dedicated eval slice.
- Boilerplate-driven false positives reduced by >=50% on lexical-noise eval slice.
- No regression on broad cross-episode queries.

### Phase 3: Synthesis Policy and Answer Grounding (1-2 weeks)
Objective: make answer depth predictable and evidence-driven.

Deliverables:
- Formalize synthesis policy matrix by query class:
  - metadata-answerable factual
  - transcript-depth factual
  - interpretive
  - hybrid
- Align quick/deep behavior and `canDeepen` semantics across endpoints.
- Add stricter citation grounding checks:
  - require source linkage for key claims.
  - add fallback response when evidence is weak.
- Add answerability guardrails to reduce confident-but-thin responses.
- Add episode-attribution integrity checks in synthesis:
  - when citing transcript evidence, preserve the source chunk's episode title exactly.
  - prohibit cross-episode blending (quote/details from episode A labeled as episode B).
  - require uncertainty wording when evidence spans multiple episodes without a clear primary.
- Add role-aware attribution constraints in synthesis:
  - distinguish hosts vs guests in the provided context.
  - for host-scoped queries, exclude guest-only evidence unless explicitly requested.
- Add preference-confidence policy for "favorite/all-time/best" queries:
  - require repeated/strong evidence before asserting a preference.
  - downgrade to "mentioned" language when evidence is sparse.
  - prohibit upgrading a single mention into "favorite" claims.
- Add cross-episode aggregation response policy for trait/persona queries:
  - when query asks "what do we know about X and Y", aggregate evidence across episodes before concluding "no information."
  - require returning top supporting quotes/episodes when evidence exists, even if weak.
  - if evidence is mixed/ambiguous, return a qualified summary with uncertainty labels instead of flat denial.
- Add anecdote-linkage response policy for multi-clause factual prompts:
  - if evidence contains the named entity and event context but misses one clause, return the partial finding + likely episode instead of a full "no information" denial.
  - require explicit "insufficient excerpt coverage" wording when only part of the anecdote is present.
  - preserve episode attribution for each clause (setup vs follow-up) when they come from different excerpts/episodes.

Exit Criteria:
- Policy matrix implemented in one shared module.
- Citation coverage threshold met on eval (target >=90% claim grounding for supported queries).
- Episode attribution precision >=98% on citation-bearing answers in eval.
- Host-scoped queries attribute people correctly (target >=95% precision on eval slice).
- Preference-style answers pass evidence-threshold assertions on eval slice.
- Trait/persona aggregation queries return evidence-backed summaries with <=5% false "no information" rate on eval slice.
- Reduced hallucination-style failures in manual review samples.

### Phase 4: Eval, CI Gates, and Feedback Intelligence (2 weeks, parallelizable)
Objective: make quality changes safe and continuously measurable.

Deliverables:
- Extend eval harness with:
  - Recall@k, MRR, answerability rate, latency percentiles.
  - routing correctness assertions.
  - quick vs deep behavior assertions.
  - role and medium assertions for high-risk queries:
    - host-only query must not include guest-only attributions.
    - TV-only query must not return film-only results unless explicitly mixed intent.
    - "favorite/all-time" query must include evidence-strength labels or conservative wording.
  - episode attribution assertions:
    - if answer claims "discussed in [episode]", at least one cited chunk must come from that episode.
    - quoted details must map to the same episode named in the surrounding claim.
  - person-centric trait assertions:
    - if transcripts contain co-occurring evidence for entity+concept (e.g., Corey + whip), answer must not return "no information."
    - outputs must include at least one supporting quote/episode for positive claims.
    - credits/outro-only matches should not satisfy evidence requirements.
  - anecdote-linkage assertions:
    - multi-clause factual query (entity + event + "what episode") must return at least one supporting episode when any clause is evidenced.
    - if only partial evidence is retrieved, answer must not claim total absence; it must return partial + uncertainty.
  - windowed phrase-frequency assertions:
    - for known gold queries (for example, "we'll get there" first 100 vs last 100), reported counts must match offline transcript-scan fixtures.
    - both `/api/search` and `/api/search/stream` must return the same winner and same per-window counts for the same input.
    - responses must include coverage disclosure when transcripts are missing in either window.
- Add CI gate:
  - fail on pass-rate drops above threshold.
  - fail on p95 latency regression above threshold.
- Join query and feedback logs via `queryId` consistently.
- Add weekly triage report generator:
  - top failing intents
  - misroute breakdown
  - latency trend
  - most common negative feedback themes

Exit Criteria:
- Eval metrics reported in machine-readable JSON on every CI run.
- CI gate active on main PR path.
- New role/medium/preference assertion suite runs in CI and blocks regressions.
- Episode-attribution assertion suite runs in CI and blocks regressions.
- Person-centric trait assertion suite runs in CI and blocks regressions.
- Weekly report produced automatically.

### Phase 5: Metadata Quality and Freshness (2-3 weeks)
Objective: reduce filter misses and data drift.

Deliverables:
- Canonicalize entities (film, guest, reviewer, director, actor, genre).
- Move from substring-first matching toward exact/synonym/fuzzy tiered matching.
- Add validation pipeline (required fields, duplicates, malformed values, enrichment completeness).
- Automate metadata sync from source-of-truth with promotion checks and diff summaries.

Exit Criteria:
- Measurable drop in false-positive and false-negative metadata matches.
- Metadata freshness SLA: <7 days.
- Validation failures block promotion.

## Workstreams and Ownership
- Routing + API consistency: backend search owner.
- Retrieval + ranking: search relevance owner.
- Synthesis + grounding: LLM integration owner.
- Eval/CI/telemetry: platform + DX owner.
- Metadata data quality: data pipeline owner.

## Milestones
- M1 (end Phase 1): unified routing policy shipped. ✅
- M1.5 (end Phase 2a): high-impact retrieval trio shipped. ✅ Eval: 45/52 → 50/52.
- M2 (end Phase 2b): remaining retrieval gains validated on eval set.
- M3 (end Phase 3): synthesis policy matrix and grounding checks shipped.
- M4 (end Phase 4): CI quality gates active.
- M5 (end Phase 5): metadata pipeline automated and validated.

## Risks and Mitigations
- Risk: latency regressions from reranking.
  - Mitigation: rerank only top-N and enforce timeout fallback.
- Risk: stricter routing lowers recall for ambiguous queries.
  - Mitigation: confidence-aware fallback to hybrid.
- Risk: metadata canonicalization introduces breaking match behavior.
  - Mitigation: shadow mode + A/B eval before full rollout.
- Risk: model behavior drift over time.
  - Mitigation: nightly eval and trend alerts.

## Definition of Done
- All phase exit criteria met.
- CI gates enabled and green.
- No known endpoint policy drift.
- Documentation updated (`/docs/query-journey`) to match implementation.
- Post-launch dashboard shows stable quality/performance for 2 consecutive weeks.

## Ongoing Triage Loop
- Every newly reported bad query goes through the triage workflow in `/docs/query-failure-triage.md`.
- Each triaged query must produce:
  - root-cause attribution by pipeline stage,
  - a decision on whether planv4 already covers it,
  - a planv4 patch when coverage/metrics are insufficient,
  - a new eval regression case.
- No search-quality fix ships without a corresponding regression test case from this loop.
