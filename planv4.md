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
- Routing behavior diverges between streaming and non-streaming paths.
- Confidence signals are not fully calibrated.
- Retrieval still allows noisy/duplicative chunks in difficult queries.
- Filter relaxation is limited and not standardized.
- Quality improvements are not consistently gated in CI with quantitative metrics.
- Metadata matching is still too substring-heavy in places.

## Roadmap

### Phase 1: Routing Consistency and Guardrails (1-2 weeks)
Objective: eliminate logic drift and remove high-cost misroutes.

Deliverables:
- Unify routing/synthesis policy between `/api/search` and `/api/search/stream`.
- Centralize `useQuickSynthesis` decision in a shared utility.
- Enforce confidence-based routing policy:
  - high-confidence metadata intents: fast-path.
  - medium-confidence metadata intents: run fast-path + full pipeline, pick best.
  - low classification confidence with empty filters: force hybrid handling.
- Ensure all fast-path misses fall through with structured reason logging.

Exit Criteria:
- Shared routing policy used by both endpoints.
- 100% of requests include routing decision telemetry.
- No endpoint-specific behavior drift in regression tests.

### Phase 2: Retrieval Quality Upgrades (2-3 weeks)
Objective: raise relevance and reduce redundancy.

Deliverables:
- Add post-retrieval reranking (lightweight cross-encoder or compact LLM reranker) on top-N fused chunks.
- Add semantic deduplication for overlapping/near-identical chunks.
- Improve diversification with dynamic episode caps tied to query intent and target-episode certainty.
- Add medium-aware retrieval constraints for film vs TV intent:
  - preserve short but high-signal tokens (e.g., "tv") in query-term handling.
  - add normalization/synonym expansion for TV terms ("tv", "television", "series", "show").
  - reduce cross-medium bleed (TV query returning film-only evidence unless explicitly mixed).
- Add entity-aware retrieval mode for person-centric questions:
  - support speaker/entity constraints (e.g., "Corey", hosts, guests, voicemailers) as first-class retrieval signals.
  - prioritize chunks where entity mention and target concept co-occur within a bounded window.
  - add token normalization for possessives/plurals (e.g., "Corey's", "whips" -> "Corey", "whip").
- Suppress boilerplate lexical noise in retrieval:
  - downweight recurring outro language and signature phrases that inflate lexical matches (e.g., "Whip Song" credits).
  - add optional segment-type filtering so factual/persona queries can avoid credits/outro-heavy chunks.
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
- M1 (end Phase 1): unified routing policy shipped.
- M2 (end Phase 2): retrieval gains validated on eval set.
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
