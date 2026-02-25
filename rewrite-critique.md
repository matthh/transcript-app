# Rewrite Critique: `docs/rewrite.md`

## Goal Of This Critique
This document challenges the current rewrite proposal and tightens it into an implementation-ready plan that minimizes regression risk to the existing 66/66 RAG baseline.

## Executive Assessment
- The rewrite proposal is directionally strong: keep RAG as default and add agent search for a narrow hard-query class.
- The current design is still too broad in routing, underspecified in evaluation, and light on rollout/rollback controls.
- The fastest safe path is: ship agent as a gated experimental branch with strict deterministic entry criteria, shadow logging, and explicit quality/latency abort thresholds.

## Critical Questions To Resolve Before Build
1. What exact query classes must route to agent on day 1?
- Current regex rules in the rewrite doc are broad and likely to over-route.
- Recommendation: start with only FM-16/FM-06 style aggregation phrases and explicit counting prompts.

2. What is the hard success criterion beyond "still 66/66"?
- Rewrite should define new metrics for novel-query generalization, not just existing pass/fail preservation.
- Recommendation: add `agent_slice_pass_rate`, `agent_routing_precision`, and `agent_p95_latency`.

3. What is the fallback contract when agent underperforms?
- Proposal does not specify whether to return partial agent output, retry via RAG, or hard-fail.
- Recommendation: define deterministic fallback order and user-visible rationale.

4. How will production transcript access be guaranteed?
- Proposal assumes filesystem grep on all transcripts; deployment behavior must be proven.
- Recommendation: benchmark both bundled transcripts and Blob-backed loading, then codify one as primary and one as fallback.

5. How do we prevent route drift and data-shape drift?
- Agent path introduces a second major inference stack and risks schema divergence.
- Recommendation: add endpoint parity assertions for `queryType`, source episode set, and logging fields.

6. What is the cost/latency budget that blocks rollout?
- "Acceptable" latency in design prose is too vague.
- Recommendation: define hard thresholds (for example, agent p95 <= 30s and timeout rate <= 2%) and auto-disable rules.

7. How do we protect grounding/attribution quality in agent responses?
- Agent tool outputs can amplify speaker misattribution if not constrained.
- Recommendation: reuse `HOST_IDENTITY_RULE`, require source-backed claims, and add FM-07 attribution checks to agent eval slice.

## Proposed Improvements To `docs/rewrite.md`

### 1) Narrow Initial Scope
- Change rollout target from "agent for all aggregation/cultural-reference patterns" to:
- Phase A: only deterministic patterns matching FM-16/FM-06 counting/recurrence prompts.
- Phase B: add one additional class only after metrics are stable for 1-2 weeks.

### 2) Add Feature Flags And Kill Switches
- Add config flags:
- `AGENT_SEARCH_ENABLED`
- `AGENT_SEARCH_PERCENT_ROLLOUT`
- `AGENT_SEARCH_FORCE_FOR_TAGS`
- `AGENT_SEARCH_DISABLE_ON_ERROR_RATE`
- This avoids code rollback for operational incidents.

### 3) Route By Two-Step Decision With Conservative Default
- Step 1: classifier can suggest `searchStrategy=agent`.
- Step 2: deterministic policy in `routing-policy.ts` must approve.
- Default to RAG if disagreement, low confidence, or any tool/transcript availability uncertainty.

### 4) Define Deterministic Fallback Semantics
- If agent times out, return RAG answer with explicit note that deep exhaustive search timed out.
- If agent finds weak evidence, force conservative answer wording and include coverage note.
- If agent tool errors exceed threshold in a single request, stop loop early and fall back.

### 5) Add Agent-Specific Eval And CI Gates
- Add `agent` tag slice in `data/eval-dataset.json`.
- Require:
- no regression in full suite pass rate,
- agent slice pass rate at or above baseline on targeted cases,
- endpoint parity on shared claims for agent-tagged cases.

### 6) Strengthen Telemetry For Triage
- Extend query log with:
- `searchStrategy` (`rag` or `agent`),
- `agentIterationCount`,
- `agentToolCallCount`,
- `agentFallbackReason`,
- `agentLatencyBreakdownMs` (route, tooling, synthesis).

### 7) Keep RAG Safety Nets Intact
- Explicitly preserve existing RAG handling for:
- Whisper-error synonym bridging in BM25,
- boilerplate suppression and dedup controls,
- deterministic film/debut resolution.
- Agent path should not replace these until proven on long-run data.

### 8) Define Prompt/Test Contract For Agent
- Add test fixtures for:
- host attribution correctness,
- episode attribution correctness,
- negative-proof queries ("never said X"),
- count/frequency consistency across repeated runs.

## Risks In Current Rewrite Design
- Over-routing to agent may degrade latency and consistency for queries RAG already handles well.
- Full-corpus grep in multiple loop turns can become expensive without caching and cutoffs.
- Agent non-determinism can make regression debugging harder unless structured telemetry is added.
- Source coverage can look high while still missing the key episode due to pattern choice errors.

## Where To Edit For X (Practical Map)

### Routing and query strategy decisions
- Add/shape strategy fields: `src/types/episode-metadata.ts`
- Classifier output + parsing + deterministic overrides: `src/lib/query-classifier.ts`
- Central policy gate: `src/lib/routing-policy.ts`
- Runtime branch insertion:
- `src/app/api/search/route.ts`
- `src/app/api/search/stream/route.ts`

### Agent orchestration and tools
- New module for loop + tools: `src/lib/agent-search.ts` (proposed)
- Reuse metadata querying from: `src/lib/metadata-store.ts`
- Reuse host/synthesis constraints from: `src/lib/claude.ts`
- Transcript file/data handling:
- `src/types/transcript.ts`
- `src/lib/blob-storage.ts`
- `scripts/download-blob-transcripts.ts`
- `scripts/upload-transcript-to-blob.ts`

### Retrieval behavior (existing RAG safety path)
- Hybrid pipeline flow and score operations: `src/lib/hybrid-retrieval.ts`
- BM25 synonyms/noise behavior: `src/lib/bm25.ts`
- Vector retrieval and scoped search: `src/lib/vectorstore.ts`
- Reranking behavior: `src/lib/reranker.ts`

### Grounding, attribution, and synthesis policies
- Prompt rules and model behavior: `src/lib/claude.ts`
- Shared synthesis policy decisions: `src/lib/routing-policy.ts`
- Follow-up synthesis handling: `src/app/api/search/followup/route.ts`

### Logging, observability, and failure triage
- Query log schema and writes: `src/lib/query-logger.ts`
- Eval/feedback API surfaces:
- `src/app/api/eval/results/route.ts`
- `src/app/api/eval/feedback/route.ts`
- Feedback to eval conversion: `scripts/feedback-to-eval.ts`

### Eval harness and regression suites
- Main eval runner and assertions: `scripts/eval-search.ts`
- Dataset cases/tags: `data/eval-dataset.json`
- Regression suites:
- `scripts/regression-routing.ts`
- `scripts/regression-queries.ts`
- `scripts/regression-retrieval.ts`
- Eval UI inspection: `src/app/eval/page.tsx`

### Data ingest and chunk strategy
- Chunk generation and special sub-chunks: `scripts/ingest.ts`
- Search data packaging/upload:
- `scripts/bundle-data.ts`
- `scripts/upload-search-data.ts`

### Deployment/runtime packaging concerns
- Server runtime packaging/tracing: `next.config.js`
- Environment/config defaults: `.env.local` and deployment env settings

### Docs that must stay in sync
- Query flow: `docs/query-journey.md`
- Failure taxonomy: `docs/query-failure-modes.md`
- Roadmap/phase commitments: `planv4.md`

## Suggested Next Step
Before any implementation PR, convert this critique into a small "Rewrite v2 scope" patch in `docs/rewrite.md` with:
- an explicit day-1 routing subset,
- success/failure rollout metrics,
- fallback semantics,
- and a test plan keyed to FM tags.
