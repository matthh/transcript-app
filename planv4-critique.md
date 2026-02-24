# Plan v4 Critique: Search Quality Roadmap

## Summary Assessment
Plan v4 is a strong, execution-oriented roadmap with clear phase boundaries and measurable goals. It captures the real failure modes observed so far and ties improvements to tangible eval outcomes. The plan is especially strong in Phase 1–3 for tactical fixes and prompt stabilization.

Where it is weaker is in the operationalization of its metrics and eval gates: the plan sets ambitious targets but doesn’t fully specify how those targets map to the current eval dataset, how flakiness is handled, or how “known limitations” are gated in CI. The updated eval dataset is richer but still uneven across the plan’s own exit criteria.

## Failure Modes Alignment (docs/query-failure-modes.md)
The failure-mode taxonomy is a solid backbone and aligns well with the plan’s sequencing guidance. Most FM categories are referenced explicitly in the plan, but several are not yet concretely enforced by eval cases or CI gates:
- FM-05 (windowed frequency comparison) is called out but has no explicit eval cases in the dataset.
- FM-08 (episode attribution error) and FM-11 (weak-evidence overclaim) are listed in the plan’s Phase 3 deliverables but are not concretely asserted in the eval dataset.
- FM-09 (medium contamination) is acknowledged in Phase 2d/4 but lacks targeted eval coverage with explicit reject conditions.
- FM-07 (role attribution) has a few cases, but guest-only evidence exclusion is not explicitly asserted.

The failure-modes doc also sets expectations for endpoint parity and uncertainty wording. Those expectations are not yet encoded in eval or CI.

## Eval Dataset Observations (data/eval-dataset.json)
The dataset now covers a wide slice of risk areas:
- Intent routing, metadata fast-path, and episode lookup intents.
- Retrieval breadth (cross-episode, voicemail, thematic) and episode-scoped cases.
- Synthesis risks: ambiguous terms (Zelda), implicit knowledge (Wachowskis/Bound), anecdote linkage, host attribution.
- Regression-focused guards: boilerplate suppression, film fallback isolation, “full catalog” known limitation.

Gaps vs plan goals:
- No explicit eval cases for windowed phrase-frequency queries (FM-05 / Phase 2d deliverable).
- No systematic checks for quick vs deep parity across `/api/search` and `/api/search/stream` in the eval dataset itself.
- Limited coverage for metadata quality/refresh (Phase 5) and filter relaxation policies (Phase 2d).
- Host/guest attribution tests exist but are sparse; guest-only evidence exclusion is not explicitly asserted (FM-07).
- No explicit latency or p95 performance checks in eval data (those are in plan metrics but not in the dataset).

## Plan Strengths
- Clear routing unification and confidence-based guardrails (Phase 1) with regression tests.
- Retrieval improvements are layered and concrete (2a–2c), with demonstrated eval wins.
- Synthesis policy explicitly targets known failure modes and adds guardrails rather than relying on vague “prompt tweaks.”
- CI gate and triage loop are explicitly scoped in Phase 4, which is essential for long-term quality.

## Gaps and Risks
1. Metric-to-eval mapping is underspecified.
   - Plan targets MRR/Recall@10 and “pass rate” without defining dataset subsets, weights, or thresholds for “known limitations” and flaky cases.
   - The dataset mixes deterministic metadata queries and open-ended interpretive queries; they should not share the same gating criteria.

2. Flakiness management is weakly defined.
   - Several cases are marked flaky; the plan mentions nondeterminism but does not define retry policy or deterministic replay behavior in CI.

3. Endpoint parity is a stated goal but not enforced by tests.
   - There is no explicit eval requirement that `/api/search` and `/api/search/stream` return equivalent answers, citations, or routing decisions.

4. Phase 2d is broad and potentially overloaded.
   - It mixes deterministic transcript analysis (windowed phrase frequency) with query expansion, entity-aware retrieval, and filter relaxation. These are different classes of work with different testing requirements.

5. Metadata quality in Phase 5 lacks early guardrails.
   - Phase 5 is far away, but metadata problems can invalidate eval results today. There is no interim validation gate to prevent obvious metadata regressions.

6. Failure-mode to eval mapping is incomplete.
   - FM-05, FM-08, FM-09, and FM-11 are called out but lack targeted eval cases with explicit positive/negative assertions and attribution checks.

## Suggestions for Improvement
1. Define eval tiers and gating rules.
   - Split eval into tiers: `gating`, `non-gating`, `known-limitation`, `flaky`.
   - Require 100% pass on gating tests and allow partial pass on non-gating and known-limitation sets.
   - Add weights or priorities so improvements don’t overfit to a single cluster.

2. Formalize flakiness handling.
   - Require N-of-M passes for flaky cases (e.g., 3/5) or lock the LLM temperature for eval runs.
   - Store deterministic snapshots of retrieved chunks to separate retrieval from synthesis variance.

3. Add explicit parity tests between endpoints.
   - For a subset of queries, assert matching classification, sources, and key answer claims across `/api/search` and `/api/search/stream`.

4. Split Phase 2d into two sub-phases.
   - 2d-1: deterministic transcript analytics (windowed phrase-frequency, aggregation queries).
   - 2d-2: retrieval expansions and entity-aware constraints.
   - This reduces risk of mixing evaluation harness work with retrieval changes.

5. Add eval coverage for plan commitments.
   - Windowed phrase-frequency (FM-05): add 2–3 gold queries with known counts and episode windows.
   - Filter relaxation: add a case with strict filters that must relax and report rationale.
   - Medium-aware constraints (FM-09): add TV-only and film-only queries with explicit reject conditions.
   - Episode attribution (FM-08): add assertions that the cited episode matches the quoted chunk.
   - Weak-evidence overclaim (FM-11): add preference/favorite cases with explicit evidence thresholds.

6. Add interim metadata validation gates ahead of Phase 5.
   - Basic metadata sanity checks (missing fields, duplicate titles, malformed years) should run in CI before Phase 5.

7. Strengthen evidence grounding assertions.
   - Require that at least one cited chunk contains the key entity or phrase for factual answers.
   - Add automatic checks that quoted evidence matches the attributed episode.

## Bottom Line
Plan v4 is directionally solid and already delivered real quality gains, but its evaluation framework is not yet strong enough to enforce the same rigor the plan promises. Tightening the eval tiers, explicitly mapping failure modes to eval coverage, defining flakiness handling, and adding endpoint parity + windowed analysis tests will make the roadmap measurably safer and faster to execute.

## Appendix: Failure-Mode Coverage Matrix (Eval Dataset)
FM-01 Intent/Classification Misroute: Partially covered. There are classification-type expectations and metadata intent cases, but no explicit misroute assertion tied to fast-path misses.
FM-02 Endpoint Drift: Not covered. No parity assertions between `/api/search` and `/api/search/stream`.
FM-03 Filter Extraction Failure: Covered. Explicit FM-03 cases in eval dataset for episode-scoped retrieval.
FM-04 Sparse Retrieval Miss: Covered. FM-04 appears with quote/episode-scoped cases; additional retrieval-heavy cases exist.
FM-05 Windowed Frequency Comparison Failure: Not covered. No gold windowed-count cases.
FM-06 Cross-Episode Aggregation Failure: Partially covered. One explicit FM-06 case plus a few cross-episode aggregation queries.
FM-07 Role Attribution Error: Partially covered. Two FM-07 cases exist, but guest-only exclusion and speaker-label correctness are not asserted broadly.
FM-08 Episode Attribution Error: Partially covered. Some cases expect a source episode, but there is no explicit citation-episode consistency check.
FM-09 Medium Contamination (Film vs TV): Not covered. No TV-only/film-only reject cases.
FM-10 Boilerplate/Outro Dominance: Partially covered. A boilerplate regression case exists, but coverage is narrow.
FM-11 Weak-Evidence Overclaim: Not covered. No explicit preference/favorite evidence-threshold assertions.
FM-12 Fast-Path Dead-End or Thin Fallback: Partially covered. Episode lookup and latest/season intents are present, but fallback rationale is not asserted.
FM-13 Ambiguous Term Scope Narrowing: Covered. Explicit FM-13 “Mark” case plus Zelda multi-referent case.
FM-14 Synthesis Implicit Knowledge Gap: Covered. Explicit FM-14 Wachowskis/Bound case.
