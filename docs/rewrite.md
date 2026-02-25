# Design Review: Agent-Grep Hybrid Search Architecture

**Author**: Claude (AI pair programmer)
**Date**: 2026-02-24
**Updated**: 2026-02-24 (post-critique, incorporating operational controls)
**Status**: Draft — critique addressed, ready for implementation review
**Scope**: Add a general-purpose agent search path to replace bespoke per-query-pattern RAG patches with a scalable architecture

---

## 1. Motivation

### 1.1 Current System

The Escape Hatch podcast search app uses a hybrid RAG pipeline (embedding + BM25) with a multi-stage retrieval pipeline feeding into Claude Sonnet synthesis. The system scores **66/66 (100%)** on eval after Phase 5.

**Architecture summary:**
```
Query → Intent Detection → Haiku Classifier → Metadata + Transcript Search
  → RRF Fusion → Supplemental Query Merge → Episode Injection
  → Keyword/Speaker/Episode Boost → Boilerplate Suppression
  → Dedup → Diversification → Adjacent Expansion
  → Haiku Reranking → Sonnet Synthesis → Response
```

**Corpus**: 300 transcripts, 5.4M words (~9.2M tokens), speaker-labeled JSON with timestamps. Pre-chunked into 4,848 chunks with 1,536-dim embeddings + BM25 index. Three chunk types:
- **Standard chunks**: ~50 per episode, ~1,750 tokens each
- **Personal-aside chunks**: 8 chunks across 5 episodes (food preferences), `_1000+` ID offset
- **Catchphrase chunks**: 15 chunks across 14 episodes ("you hack"), `_2000+` ID offset

**Phase 5 additions**: Supplemental query expansion (Haiku generates 1-3 rephrased queries for persona/aggregation patterns, merged via multi-query RRF with 0.7x discount), catchphrase sub-chunking with semantic prefixes, BM25 catchphrase synonyms.

### 1.2 Context: How We Got to 100%

Phase 5 resolved the two failures (FM-13, FM-16) that originally motivated this design doc:

| Failure | Original Root Cause | Phase 5 Fix |
|---------|-------------------|-------------|
| **FM-16** (catchphrase) | BM25 searched for "catchphrase" literally, surfacing meta-discussion instead of actual repeated phrases | Catchphrase sub-chunking (`_2000+` offset, 15 chunks) + deterministic supplemental queries + BM25 synonyms |
| **FM-13** (The Mark) | Cultural reference didn't match on embedding/keyword similarity | Full corpus re-ingest (3,131 → 4,848 chunks) improved coverage; American Movie chunks now surface |
| **FM-15** (favorite foods) | Personal mentions scattered in film-dominated episodes | Personal-aside sub-chunking (`_1000+` offset, 8 chunks) — resolved in Phase 4+ |

**These were solved by extending RAG** — not by adding agent reasoning. Each fix followed the same pattern: identify a retrieval gap → create specialized sub-chunks or query expansions → re-ingest. This pattern is the core problem this design doc addresses.

### 1.3 The Scalability Problem: Bespoke Fixes Don't Generalize

The Phase 4-5 fixes work, but they follow a pattern that doesn't scale:

| Fix | What It Handles | What It Doesn't Handle |
|-----|----------------|----------------------|
| Catchphrase sub-chunking (`_2000+`) | "you hack" specifically | Any other recurring phrase, running joke, or speech pattern |
| Personal-aside sub-chunking (`_1000+`) | Food preferences matching 15 hardcoded keywords | Music preferences, movie-watching habits, personal anecdotes, or any topic not in the keyword list |
| BM25 catchphrase synonyms | `catchphrase` → `phrase, saying, says, always` | Any other concept-to-instance vocabulary gap |
| Deterministic supplemental queries | Catchphrase + host name patterns | Novel aggregation patterns not anticipated in prompt examples |
| Eszterhas BM25 synonyms | One specific Whisper transcription error | Every other proper name Whisper mangles |

**Each failure mode required a hand-crafted patch.** The pipeline now has:
- 14+ retrieval stages
- 3 chunk types with separate ID offset schemes
- 4 BM25 synonym clusters
- 3 deterministic override systems (film, debut, catchphrase)
- LLM-generated supplemental queries trained on specific examples

**The next novel query in any of these classes will fail the same way**, requiring another bespoke chunk type, another synonym map entry, or another deterministic override. This is O(n) engineering effort per failure mode.

An agent path inverts this: instead of pre-computing patches for anticipated query patterns, an LLM reasons about each query at runtime. The same agent loop that finds Jason's catchphrase "you hack" can also find Haitch's recurring jokes, or any other cross-episode pattern — **without any new code, chunks, or synonyms**.

### 1.4 RAG's Remaining Structural Limitations

Even with Phase 5, the RAG pipeline cannot:

- **Do exhaustive search**: Top-K sampling can't count occurrences or prove negatives ("How many times does Jason say X?", "Did they ever discuss Y?")
- **Iterate on search results**: One-shot retrieval (even with supplemental queries) can't search, evaluate results, and reformulate. Supplemental queries are generated *before* seeing any results.
- **Reason about novel patterns**: Supplemental queries are generated from prompt examples — they can't reason about genuinely unforeseen aggregation patterns
- **Handle concept-vs-instance generically**: The catchphrase fix was hardcoded for "you hack". A query about a different recurring speech pattern would hit the same wall until someone adds another sub-chunk type.

These aren't bugs — they're architectural constraints of pre-indexed chunk retrieval. An agent path addresses them generically.

### 1.5 Why Not a Full Rewrite?

We evaluated replacing the entire RAG pipeline with an agent-grep architecture. The case-by-case analysis across all 66 eval cases showed:

- **~40 of 66 cases** (metadata lookups, single-episode opinions, quote retrieval) are well-served by RAG. An agent would produce the same quality answer 10x slower.
- **~15 cases** are a wash — both architectures succeed, RAG is faster.
- **~8-10 cases** are the bespoke-fix zone — currently handled by Phase 4-5 patches that don't generalize.
- **Agent-grep risks regressions** in areas where RAG has hard-won advantages:
  - Whisper transcription error bridging (BM25 synonyms map "Joe Eszterhas" → "Jo Esther house")
  - Boilerplate suppression (pipeline downranks outro/credits content)
  - Semantic bridging across vocabulary gaps (embeddings find "shells and cheese" for "Velveeta")
  - Deterministic film catalog resolution (`findFilmFromQuery()` always matches canonical titles)

**Decision**: Keep RAG for the ~90% of queries it handles well. Add an agent path for query classes that currently require bespoke patches — replacing O(n) per-pattern engineering with a single general-purpose search system.

---

## 2. Architecture Comparison: RAG vs Agent-Grep

### 2.1 What RAG Does Well

| Strength | How It Works | Example |
|----------|-------------|---------|
| **Fast semantic search** | Cosine similarity on 1,536-dim embeddings finds related content in <1s | "What did the hosts think about Jaws" → finds Jaws episode chunks |
| **Vocabulary bridging** | Embedding vectors are close even when words differ | "Zelda" finds Zelda Rubinstein mentions across Poltergeist and Southland Tales |
| **Whisper error handling** | BM25 synonym map bridges transcription errors | "Joe Eszterhas" → "Jo Esther house" / "Ester houses" |
| **Deterministic film resolution** | `findFilmFromQuery()` canonical catalog match | "They Live" always resolves to "They Live (1988)" |
| **Noise suppression** | 14-stage pipeline: boilerplate suppression, dedup, diversification, episode caps | Outro segments don't dominate results |
| **Controllable tuning** | Numeric boost/penalty knobs (1.15x keyword, 1.3x speaker, 1.5x episode, 0.3x boilerplate) | Each knob is independently tunable and debuggable |
| **Speed** | ~2-5 seconds end-to-end | Acceptable for all query types |

### 2.2 What RAG Cannot Do (Even After Phase 5)

| Limitation | Why | Phase 5 Mitigation | Remaining Gap |
|-----------|-----|-------------------|---------------|
| **Reason about search strategy** | Query IS the search — no reformulation | Supplemental queries provide 1-3 rephrased alternatives | Supplemental queries are generated from prompt examples, not reasoning; novel patterns may miss |
| **Iterative refinement** | One-shot retrieval | Supplemental query merge adds a second "perspective" | Can't evaluate results and reformulate — still single-pass |
| **Cultural reference resolution** | Requires world-knowledge inference before searching | Re-ingest incidentally improved FM-13 coverage | Not a targeted fix; next cultural reference may fail identically |
| **Exhaustive search** | Top-K sampling by definition | N/A — not addressed | Can't count occurrences, prove negatives, or do frequency analysis |
| **Cross-episode aggregation** | Retrieves best-matching chunks, not all instances | Catchphrase sub-chunking for known phrases | Only works for pre-identified catchphrases; novel "recurring X" queries unhandled |

### 2.3 What Agent-Grep Adds

An LLM agent with transcript search tools can:

1. **Reason about search strategy**: "catchphrase" query → reason that we need to find repeated phrases → grep for candidate phrases → count occurrences across episodes
2. **Iterate**: Search → evaluate results → reformulate → search again
3. **Use world knowledge**: "The Mark" → infer Mark Borchardt connection → search for American Movie content → verify
4. **Do exhaustive search**: Grep the entire corpus for a pattern, count matches
5. **Handle concept-vs-instance**: Distinguish "discussions about catchphrases" from "instances of repeated speech"

### 2.4 Where Query Classes Map to Architectures

The query taxonomy reveals two distinct categories that map cleanly to different architectures:

**Category 1 — "Right chunk exists, need to find it"** (~90% of queries):
Single-episode factual questions, film-scoped quotes, guest attribution, episode lookups. The evidence exists in 1-3 chunks. Similarity search finds them. **RAG is ideal** — fast, cheap, reliable.

**Category 2 — "Need to reason about what to search for"** (~10% of queries):
Cross-episode aggregation, cultural references, concept-vs-instance, exhaustive scan, counting/frequency. The evidence is distributed or requires inference about search strategy. **Agents are ideal** — they can reason, iterate, and do exhaustive search.

Phase 5 addressed specific Category 2 instances (FM-13, FM-16) via bespoke sub-chunking and supplemental queries. The agent path would handle Category 2 *generically*, without requiring new sub-chunk types or synonym maps for each new pattern.

### 2.5 Agent-Grep Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Latency** (15-30s vs 3-5s) | Medium | Only agent-eligible queries routed there; progress events keep UI responsive |
| **Cost** (10-50x more tokens) | Low | System is not heavily used; cost is not a driver |
| **Non-determinism** | Medium | Same query may take different agent paths on different runs; eval may show variance |
| **No Whisper error bridging** | Medium | Agent grepping for "Eszterhas" finds nothing without fuzzy variants. Mitigated: these queries should still route to RAG |
| **No boilerplate suppression** | Low | Agent sees raw transcripts including outro content; system prompt instructs to focus on substantive content |
| **No semantic bridging** | Medium | Agent needs to guess search terms. Mitigated: agent has world knowledge about alternative names/brands |
| **Regression risk** | Low | RAG path is completely untouched; only new routing branch added |

---

## 3. Proposed Architecture

### 3.1 High-Level Flow

```
Query → Intent Detection → Haiku Classifier (now outputs searchStrategy)
                                    |
                    +---------------+---------------+
                    |                               |
              searchStrategy='rag'           searchStrategy='agent'
                    |                               |
             [Existing 14-stage              Agent Loop (Sonnet)
              RAG pipeline —                 with transcript tools
              completely untouched]          (grep, read, metadata)
                    |                               |
             Sonnet Synthesis              Agent synthesizes answer
                    |                               |
              Response (2-5s)              Response (15-30s)
```

### 3.2 Routing Decision

Two-step gate with phased rollout. Default is always RAG — agent must be explicitly approved by both layers.

**Step 1 — LLM classifier suggests**: The existing Haiku classifier gets a new `searchStrategy` output field. Prompt examples teach it to recognize aggregation, frequency, cross-episode pattern, and cultural reference queries. The classifier *suggests* `searchStrategy='agent'` but cannot unilaterally activate the agent path.

**Step 2 — Deterministic policy approves**: `shouldUseAgentSearch()` in `routing-policy.ts` gates the final decision. The agent path activates only when **all** of the following hold:
- `AGENT_SEARCH_ENABLED` feature flag is `true` (see Section 3.8)
- Query matches a deterministic regex pattern for the current rollout phase
- Classifier suggested `searchStrategy='agent'` **or** query matches a force-override pattern
- Rollout percentage check passes (`AGENT_SEARCH_PERCENT_ROLLOUT`)

On any disagreement, low confidence, or feature flag off → default to RAG.

#### Phase A — Day-1 Scope (Narrow)

Only FM-16/FM-06 style queries: aggregation, recurrence, counting. Two regex patterns:

```regex
/\b(catchphrase|recurring phrase|always says|running joke)\b/i
/\b(how many times|how often|every time)\b.*\b(say|said|mention)\b/i
```

The following broad patterns from early drafts are explicitly **deferred to Phase B**:
- ~~`/\b(who says .* more|says .* the most)\b/i`~~
- ~~`/\b(all the times|every mention|across (?:all )?episodes)\b/i`~~
- ~~`/\b(how often|how many times|every time|most frequent)\b/i`~~ (the standalone version without verb anchor)

#### Phase B — Expanded Scope (After 1-2 Weeks of Stable Metrics)

Add additional patterns only after Phase A metrics are stable (see Section 5 success criteria):
- Cultural reference patterns
- Exhaustive scan patterns (`across all episodes`, `every mention`)
- Broader aggregation (`most frequent`, `who says X more`)

**Interaction with Phase 5 supplemental queries**: The existing supplemental query system (generated by the Haiku classifier for persona/aggregation patterns) runs within the RAG pipeline. When a query is routed to the agent path, the supplemental query system is bypassed entirely — the agent does its own iterative search instead. For RAG-routed queries, supplemental queries continue to fire as before. These are mutually exclusive paths.

**Insertion point**: After classification completes (~line 382 in `src/app/api/search/stream/route.ts`), before metadata + transcript search begins. No wasted RAG retrieval work for agent queries.

### 3.3 Agent Tools

The agent gets four tools:

| Tool | Purpose | Implementation | Performance |
|------|---------|---------------|-------------|
| `grep_transcripts(pattern, speaker_filter?, max_results?)` | Regex search across all 300 transcripts | Read each `transcripts/episode_*.json`, iterate dialogues, test regex. Returns matches with episode, speaker, timestamp, text, +-1 dialogue context | ~1-2s for full corpus scan (43MB JSON on filesystem) |
| `read_episode_transcript(episode_number)` | Read full transcript of one episode | Load single JSON file, format as `[timestamp] speaker: text` | ~23K tokens per episode |
| `search_episodes(film?, guest?, director?, ...)` | Search episode metadata | Wrapper around existing `queryEpisodes()` from `src/lib/metadata-store.ts` | Instant (in-memory) |
| `list_episodes(limit?, offset?)` | List all episodes with numbers and titles | Wrapper around existing metadata store | Instant |

**Design choice — grep over raw JSON vs. using existing BM25/embedding index**: The agent greps raw transcript files rather than the existing retrieval pipeline. This is intentional:
- Raw transcripts have full context (surrounding dialogue, speaker attribution, timestamps)
- No chunk boundary artifacts (anecdotes that span chunks are intact)
- The agent can use regex patterns that BM25 can't express (e.g., `\byou hack\b` with word boundaries)
- The existing index is optimized for single-query similarity, not iterative multi-pattern search

### 3.4 Agent Loop

```
runAgentSearch(query, classification):
  messages = [{ role: 'user', content: query }]
  collectedSources = new Map()  // deduplicated TranscriptSource objects

  for i in 1..MAX_ITERATIONS (10):
    response = claude.messages.create(
      model: 'claude-sonnet-4-20250514',
      system: agentSystemPrompt,
      tools: [grep_transcripts, read_episode_transcript, search_episodes, list_episodes],
      messages
    )

    if response.stop_reason === 'end_turn':
      return { answer: extractText(response), sources: collectedSources }

    // Process tool calls, execute them, collect sources
    for each tool_use in response.content:
      result = executeToolCall(tool_use)
      collectSources(result, collectedSources)

    messages.push(assistantResponse, toolResults)

  // Max iterations reached — force final answer
  messages.push("Provide your best answer based on what you've found")
  finalResponse = claude.messages.create(...)
  return { answer, sources }
```

### 3.5 Agent System Prompt

Key directives (reusing existing patterns from `src/lib/claude.ts`):
- **HOST_IDENTITY_RULE**: Reuse existing rule — Haitch and Jason are the only hosts
- **Search strategy**: "Start with targeted grep patterns. If initial results are sparse, try synonyms and alternative phrasings. For catchphrase/recurring queries, search for the actual phrases, not the meta-keyword. For frequency questions, count occurrences systematically."
- **Grounding**: "Only report what you find in transcripts. Use world knowledge to connect references (e.g., infer 'the Mark' → American Movie) but only if transcript evidence supports the connection."
- **Attribution**: "Attribute speech to the correct speaker. Never confuse hosts with guests."
- **Answer format**: Markdown with headings, bold, bullet points. Cite specific episodes, speakers, timestamps.

### 3.6 Source Collection

Each `grep_transcripts` match produces a `TranscriptSource` object — the same interface as RAG sources (defined in `src/types/episode-metadata.ts`):

```ts
interface TranscriptSource {
  episodeTitle: string;
  episodeNumber?: number;
  speakers: string;
  startTimestamp: string;
  endTimestamp: string;
  text: string;
  score: number;
}
```

Sources are keyed by `episodeName_timestamp` to deduplicate across multiple grep calls. The agent's sources flow back to the frontend in the identical format as RAG sources — **no frontend changes required**.

### 3.7 Streaming

For the SSE endpoint (`/api/search/stream`):
- **During agent tool-use loop**: Send `progress` events with descriptive messages ("Searching for recurring phrases...", "Reading episode 47...", "Found 12 matches across 8 episodes...")
- **Final answer**: Either chunk the completed answer into SSE events, or issue the final synthesis turn as a streaming API call for true token-by-token streaming (preferred)
- **UX differentiation**: Agent queries show "Deep searching..." with progress events. RAG queries continue to show "Searching..." as before.

### 3.8 Feature Flags and Kill Switches

All flags are configured via environment variables (`.env.local` for development, Vercel dashboard for production). No code rollback needed for incidents.

| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `AGENT_SEARCH_ENABLED` | boolean | `false` | Master on/off for agent path. Must be explicitly enabled. |
| `AGENT_SEARCH_PERCENT_ROLLOUT` | 0-100 | `100` | Percentage of eligible queries that actually route to agent. Use for gradual rollout (e.g., start at 10%, ramp to 100%). |
| `AGENT_SEARCH_FORCE_FOR_TAGS` | string[] | `[]` | Force agent path for specific eval tags (e.g., `["agent"]`). For eval/testing only — bypasses rollout percentage. |
| `AGENT_SEARCH_DISABLE_ON_ERROR_RATE` | number | `0.2` | Auto-disable agent if >20% of agent queries error in a 5-minute sliding window. Sets `AGENT_SEARCH_ENABLED=false` in-memory until manual re-enable. |

**Operational playbook**:
- **Incident**: Set `AGENT_SEARCH_ENABLED=false` in Vercel dashboard → immediate effect on next request, no deploy required.
- **Gradual rollout**: Start `AGENT_SEARCH_PERCENT_ROLLOUT=10`, monitor metrics (Section 3.10), ramp to 50/100 over days.
- **Eval testing**: Set `AGENT_SEARCH_FORCE_FOR_TAGS=["agent"]` to test agent path without affecting real traffic.

### 3.9 Fallback Semantics

When the agent path fails, the system must degrade gracefully — never return an empty or broken response.

**Parallel RAG strategy**: When a query is routed to the agent path, a RAG pipeline run fires in parallel (fire-and-forget). Only one answer is returned to the user. If the agent succeeds, the RAG result is discarded. If the agent fails, the pre-computed RAG result is ready immediately.

| Failure Mode | Trigger | Behavior |
|-------------|---------|----------|
| **Agent timeout** | Agent loop exceeds 45s | Kill agent loop. Return RAG answer with note: "Deep search timed out, showing standard results." |
| **Agent weak evidence** | <2 sources found after all iterations complete | Return agent answer with conservative wording + coverage note: "Based on limited evidence found..." |
| **Agent tool errors** | >3 tool failures in a single request | Stop agent loop early. Fall back to RAG answer. |
| **Agent model error** | API error from Sonnet (rate limit, 500, etc.) | Immediate fallback to RAG answer. |

**Fallback order**: Agent timeout/error → RAG pipeline result (already computed in parallel) → User sees standard RAG answer with no indication of agent failure beyond the note.

**User-visible contract**: The user always gets an answer. Agent failures are surfaced as informational notes, not error states.

### 3.10 Telemetry

Extend the existing `query-logger.ts` schema with structured fields for agent queries. Same log destination, same format — just additional fields when `searchStrategy='agent'`.

| Field | Type | Description |
|-------|------|-------------|
| `searchStrategy` | `'rag' \| 'agent'` | Which path handled this query |
| `agentIterationCount` | number | Number of tool-use turns in the agent loop |
| `agentToolCallCount` | number | Total tool invocations across all turns |
| `agentFallbackReason` | `null \| 'timeout' \| 'error_threshold' \| 'weak_evidence' \| 'model_error'` | Why agent fell back to RAG, if applicable |
| `agentLatencyBreakdownMs` | `{ route, tooling, synthesis, total }` | Time spent in each phase |

**Monitoring thresholds** (linked to auto-disable in Section 3.8):
- `agentFallbackReason != null` rate > 20% in 5-minute window → auto-disable
- `agentLatencyBreakdownMs.total` p95 > 30s → alert for investigation
- These fields enable post-hoc triage without adding separate logging infrastructure

---

## 4. Implementation Plan

### 4.1 Files to Modify

| File | Change |
|------|--------|
| `src/types/episode-metadata.ts` | Add `searchStrategy?: 'rag' \| 'agent'` to `ClassificationResult` |
| `src/lib/query-classifier.ts` | Extend Haiku prompt to output `searchStrategy`; parse new field |
| `src/lib/routing-policy.ts` | Add `shouldUseAgentSearch()`, agent constants, deterministic pattern overrides |
| **`src/lib/agent-search.ts`** | **New file** — agent loop, tool definitions, tool implementations, source collection |
| `src/app/api/search/stream/route.ts` | Insert agent branch after classification (~line 382), before RAG pipeline |
| `src/app/api/search/route.ts` | Mirror agent branch for JSON endpoint |
| `next.config.js` | Add `./transcripts/**/*` to `outputFileTracingIncludes` |
| `data/eval-dataset.json` | Add `"agent"` tag to FM-13, FM-16, FM-15, and aggregation eval cases |

### 4.2 Implementation Sequence

**Phase A — Types, routing, and feature flags (small)**:
- Add `searchStrategy` to `ClassificationResult` type
- Add `shouldUseAgentSearch()` to routing policy with two-step gate (Section 3.2)
- Add feature flag parsing and kill switch logic (Section 3.8)
- Add agent constants (`AGENT_SEARCH_MODEL`, `AGENT_MAX_ITERATIONS = 10`)
- Implement both filesystem and Blob transcript access paths (Section 4.3)

**Phase B — Agent module (main work)**:
- Create `src/lib/agent-search.ts`
- Implement `grep_transcripts` tool (filesystem read + regex match across 300 files)
- Implement `read_episode_transcript` tool (single file load + formatting)
- Implement `search_episodes` and `list_episodes` wrappers (delegating to existing `queryEpisodes()`)
- Implement agent loop with source collection and progress callbacks
- Write agent system prompt

**Phase C — Route integration**:
- Add agent branch to stream route (after classification, before RAG pipeline)
- Add agent branch to JSON route
- Add parallel RAG fallback (fire-and-forget, Section 3.9)
- Update `next.config.js` for transcript bundling
- Extend `query-logger.ts` with agent telemetry fields (Section 3.10)

**Phase D — Eval and tuning**:
- Tag eval cases: FM-13, FM-16, FM-15, aggregation cases get `"agent"` tag
- Run agent-only eval: `npx tsx scripts/eval-search.ts --tag agent`
- Run full regression eval to verify no RAG regressions
- Tune agent system prompt based on results

### 4.3 Transcript Access in Production

Transcripts must be available in the Vercel serverless function for filesystem-based grep. **Build both access paths from the start** (resolved in Q3, Section 9).

**Primary: Bundle via `outputFileTracingIncludes`**
- Add `'./transcripts/**/*'` to the Next.js config for both search endpoints
- Adds ~43MB to function bundle (JSON compresses well)
- Vercel limit is 250MB compressed — well within limits
- Fast filesystem access (~1-2s for full corpus grep)

**Fallback: Load from Vercel Blob**
- If filesystem read fails or bundle size becomes an issue, fall back to Blob storage
- Slower: 300 HTTP fetches, mitigated by concurrent batching (50 at a time)
- ~3-5s for full corpus grep instead of ~1-2s

Verify bundle size in Phase A. If filesystem bundling works, Blob fallback is insurance. If it doesn't, Blob is the primary path with no code changes needed.

---

## 5. Expected Impact

### 5.1 Eval Projection

The eval already passes 66/66 after Phase 5. The agent path's value is in **answer quality beyond pass/fail thresholds** and **resilience to novel queries** not yet in the eval suite.

| Case | Current (RAG) | Expected with Agent |
|------|--------------|-------------------|
| FM-16 (Jason catchphrase) | PASS (via catchphrase sub-chunking + supplemental queries) | PASS — agent would find this generically without bespoke sub-chunks |
| FM-13 (The Mark / American Movie) | PASS (via re-ingest coverage improvement) | PASS — agent would reason about cultural reference explicitly |
| FM-15 (hosts' favorite foods) | PASS (via personal-aside sub-chunking) | PASS — agent would find food mentions directly without pre-computed asides |
| Cases 44-47 (aggregation queries) | PASS (meets min threshold) | BETTER — exhaustive search provides richer, more complete answers |
| Novel aggregation/counting queries | UNKNOWN — not in eval suite | LIKELY PASS — agent handles generically without new pipeline patches |
| All other cases | PASS | UNCHANGED — routed to RAG as before |

**Projected eval**: Maintains 66/66 (100%). Primary value is generalization to queries outside the current eval suite and richer answers for aggregation cases.

### 5.2 Success Metrics (Hard Thresholds)

Agent path must meet these criteria to remain enabled. Measured continuously via telemetry (Section 3.10).

| Metric | Threshold | Action on Breach |
|--------|-----------|-----------------|
| `agent_slice_pass_rate` | >= baseline on targeted FM-16/FM-06 cases | Auto-disable via `AGENT_SEARCH_ENABLED=false` if below RAG baseline for same cases |
| `agent_routing_precision` | >= 90% (agent queries were genuinely agent-worthy) | Review and tighten routing patterns in Section 3.2 |
| `agent_p95_latency` | <= 30s | Alert for investigation; reduce `AGENT_MAX_ITERATIONS` if needed |
| `agent_timeout_rate` | <= 2% | Auto-disable if > 5% in any 5-minute window |
| Full eval suite | No regression from 66/66 baseline | Block deploy; revert routing change |

**Auto-disable rule**: If `agent_timeout_rate` > 5% **or** `agent_slice_pass_rate` drops below RAG baseline for the same cases, auto-disable agent via `AGENT_SEARCH_ENABLED=false` in-memory. Manual review and re-enable required.

### 5.3 Latency Impact

- **RAG queries (~90%)**: No change (2-5s)
- **Agent queries (~10%)**: 15-30s expected. Acceptable for complex queries that currently fail or produce thin answers. Progress events keep UI responsive during wait.

### 5.4 Cost Impact

- **RAG queries**: No change (~$0.01-0.03/query)
- **Agent queries**: ~$0.10-0.50/query (5-10 Sonnet tool-use turns + grep result tokens). System is not heavily used, so total cost impact is negligible.

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Agent routing false positives (RAG query sent to agent) | Low | Medium — slower response, possibly different quality | Conservative routing: LLM defaults to 'rag'; deterministic overrides only fire on high-confidence keyword patterns |
| Agent routing false negatives (agent query sent to RAG) | Medium | Low — RAG handles these via Phase 5 patches | Phase 5 bespoke fixes serve as safety net; can tune routing over time |
| Agent hallucination | Low | Medium | Agent sees real transcript text from tool results, not fabricated context; grounding rules in system prompt; same TranscriptSource attribution as RAG |
| Vercel function bundle too large | Low | High — deploy failure | Transcripts are 43MB JSON (compresses well); Blob fallback available if needed |
| Agent tool calls exceed Vercel timeout | Low | Medium — partial answer | `AGENT_MAX_ITERATIONS = 10` caps iterations; Vercel `maxDuration` gives headroom; force final answer on max iterations; fallback to RAG on timeout (Section 3.9) |
| Non-deterministic agent behavior | Medium | Low — eval variance | Accept some variance for agent queries; focus on consistent tool availability and prompt stability |
| Regression on existing RAG path | Very Low | High | RAG path is completely untouched — only a new routing branch is added before it |

### 6.1 RAG Safety Net Guarantee

The agent path is **additive, not substitutive**. The existing RAG pipeline is untouched — no stages removed, no parameters changed, no code paths altered for RAG-routed queries. Specifically:

- **BM25 Whisper-error synonym bridging** stays for RAG queries (e.g., "Joe Eszterhas" → "Jo Esther house")
- **Boilerplate suppression and dedup** stay for RAG queries
- **Deterministic film/debut resolution** (`findFilmFromQuery()`, `findDebutFilmFromQuery()`) stays for RAG queries
- **Speaker boost, keyword boost, episode boost** — all RAG pipeline stages unchanged
- **Phase 5 sub-chunks** (catchphrase `_2000+`, personal-aside `_1000+`) remain in the index and continue to serve RAG queries

Phase 5 bespoke sub-chunks are **not deprecated** until the agent path proves superior on long-run data (4+ weeks of stable metrics — see Section 9, Q2). Even then, deprecation requires a separate design review.

---

## 7. Verification Plan

### 7.1 Eval Dataset Updates

- Add `"agent"` tag to FM-13, FM-16, FM-15, and aggregation eval cases in `data/eval-dataset.json`
- Agent slice eval: `npx tsx scripts/eval-search.ts --tag agent`

### 7.2 Test Sequence

1. **Local smoke test**: `npm run dev` → query "If Jason had a catchphrase" → verify agent routing, grep tool calls, cross-episode evidence in response
2. **Agent-targeted eval**: `npx tsx scripts/eval-search.ts --url http://localhost:3000 --tag agent`
3. **Full regression eval**: `npx tsx scripts/eval-search.ts --url http://localhost:3000` — verify 66/66 baseline doesn't regress
4. **Latency validation**: Agent queries complete in <30s; RAG queries unaffected at 2-5s
5. **Production deploy + eval**: Push to master → Vercel auto-deploy → `npx tsx scripts/eval-search.ts --url https://search.escapehatchpod.com`

### 7.3 Endpoint Parity

Both `/api/search` (JSON) and `/api/search/stream` (SSE) must return matching results for agent-tagged cases:
- Same `queryType` classification
- Same source episode set (order may differ)
- Same key claims in the synthesized answer

### 7.4 Agent-Specific Test Fixtures

Add test fixtures covering:
- **Host attribution correctness**: Agent correctly attributes speech to Haitch vs. Jason vs. guests
- **Episode attribution correctness**: Agent cites the right episode for each piece of evidence
- **Count/frequency consistency**: Same counting query run 3 times produces consistent results (within acceptable variance)

### 7.5 CI Gate

- No regression in full suite pass rate (66/66)
- Agent slice at or above baseline on targeted cases
- Both endpoints pass parity checks

---

## 8. Future Considerations

- **Expand agent routing**: If agent quality proves consistently high and latency/cost decrease (model improvements, caching), could consider routing more query types through agent path
- **Hybrid agent+RAG**: Agent could receive RAG results as a starting point, then do targeted follow-up searches. Combines RAG's speed with agent's reasoning.
- **Pre-computed agent enrichment**: Run agents at ingest time to extract structured data (recurring phrases, food preferences, cultural references) — best latency, but front-loads computation and can't anticipate all query patterns
- **Result caching**: Cache agent results for repeated or similar queries to reduce cost/latency on subsequent hits

---

## 9. Resolved Questions

These were open questions in the original draft. Each is now resolved based on critique review.

**Q1. Routing overlap with Phase 5 supplemental queries**
**Decision**: Agent supersedes supplemental queries for agent-routed queries; supplemental queries still fire for RAG-routed queries. These are mutually exclusive paths — no conflict, no overlap. When a query routes to agent, the supplemental query system is bypassed entirely. When a query routes to RAG, the existing supplemental query pipeline runs as before. (See Section 3.2.)

**Q2. Phase 5 deprecation path**
**Decision**: Keep bespoke sub-chunks (catchphrase `_2000+`, personal-aside `_1000+`) as a RAG safety net. Do not deprecate. Evaluate deprecation only after 4+ weeks of stable agent metrics showing equivalent or better quality on the same cases. Deprecation would require a separate design review and eval confirmation. (See Section 6.1.)

**Q3. Transcript bundling strategy**
**Decision**: Build with filesystem primary + Blob fallback from the start. Implement both access paths in Phase A. Verify bundle size early — if filesystem bundling exceeds Vercel limits, Blob fallback is already in place. (See Section 4.3.)

**Q4. Agent model choice**
**Decision**: Start with Sonnet for the full agent loop (tool-use turns + final synthesis). Reasoning quality is the priority for the agent path's value proposition. Evaluate Haiku for tool-use turns in Phase B if cost becomes a concern — but only after establishing a quality baseline with Sonnet.

**Q5. Max iterations**
**Decision**: Start at 10 (not 15). Lower cap reduces worst-case latency and cost. Increase only if eval shows truncated searches where the agent ran out of iterations before finding sufficient evidence. The `AGENT_MAX_ITERATIONS` constant is easily tunable.

**Q6. Streaming UX**
**Decision**: Yes — agent queries show "Deep searching..." with progress events. RAG queries continue to show "Searching..." as before. Progress events include descriptive messages about what the agent is doing ("Searching for recurring phrases...", "Found 12 matches across 8 episodes..."). (See Section 3.7.)
