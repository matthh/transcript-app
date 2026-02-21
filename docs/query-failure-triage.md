# Query Failure Triage Loop

Use this whenever a problematic query is reported.

## Trigger
Input:
- Problem query text.
- Actual answer returned in prod (or staging).
- (Optional) expected answer qualities.

## Triage Steps
1. Reconstruct request path:
   - Identify endpoint used (`/api/search/stream` vs `/api/search`), depth, and variant.
2. Trace routing:
   - Intent detection result and confidence.
   - Classification type, confidence, filters, `requiresTranscriptDepth`.
   - If query contains an explicit episode id (for example, "episode 283"), verify:
     - `metadata_episode_lookup` intent was detected (added in Phase 1),
     - episode-number extraction succeeded,
     - metadata episode-lookup fast-path returned a deterministic summary (or fell through to full pipeline with reason when episode not found).
   - Check confidence-based routing: medium-confidence intents should skip metadata aggregate; low-confidence (< 0.6) + no filters should force hybrid.
3. Trace retrieval:
   - Metadata inclusion/exclusion decision.
   - Retrieval K, BM25 availability, fusion/boost/diversification behavior.
   - Boilerplate suppression, dedup, and adjacent-chunk expansion behavior (Phase 2a).
   - Top chunks quality (relevance, duplication, medium mismatch).
   - For broad trait/persona queries (for example, "what does X think about Y"), record unique episode count in top transcript sources.
   - If unique episode count is less than 2, flag `single_episode_anchoring_risk` and require constrained/uncertain wording in synthesis.
4. Trace synthesis:
   - Model/tokens selected.
   - Prompt policy used (factual/interpretive/hybrid).
   - Evidence quality and attribution correctness (host vs guest, film vs TV, etc.).
5. Produce root-cause summary:
   - Primary cause (most responsible stage).
   - Secondary contributors.
   - User-visible manifestation.
6. Map fixes to planv4:
   - If covered: link to phase/deliverable and add/update acceptance criteria if weak.
   - If not covered: add a new deliverable + measurable exit criterion.
7. Add eval regression case:
   - Add a case that fails before fix and passes after.
   - Include positive and negative assertions.

## Required Output Format (for each reported query)
1. `Observed failure`
2. `Trace by stage`
3. `Root cause`
4. `Planv4 coverage`
5. `Planv4 patch (if needed)`
6. `Eval case to add`
7. `Priority (P0-P3)`

## Planv4 Patch Rules
- Patch `planv4.md` only if at least one is true:
  - No existing deliverable covers the failure class.
  - Existing deliverable lacks measurable acceptance criteria for that class.
  - Failure reveals endpoint inconsistency not explicitly gated.
- Any new plan item must include:
  - Owner area (routing/retrieval/synthesis/eval/metadata).
  - Specific metric or assertion.
  - Phase placement and exit criterion.

## Copy/Paste Intake Template
Use this when reporting a new issue:

```md
Query:
Actual answer:
Why this is bad:
Expected behavior:
Any constraints (host-only, tv-only, etc.):
```
