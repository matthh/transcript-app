# Query Improvement Plan

## Goals
- Route factual/aggregate questions to metadata instead of transcript search.
- Route interpretive/entity questions to transcript search even when metadata filters would be empty.
- Reduce “No matching episodes” responses for questions that are answerable from metadata.
- Ensure “latest/current/total/max” queries return deterministic answers.

## Observed Failures (from queries.md)
- “what season is the pod on now…” → should use latest episode metadata.
- “when did zolidus join the discord” → should search transcripts.
- “what was the last episode” → should use latest episode metadata.
- “how many mmm’s in the last episode” → should use latest episode metadata + mmmCount.
- “greatest number of instances of Jason saying ‘That’s Great’” → should use metadata max(thatsGreatCount).
- “how many episodes total” → should count metadata entries.
- “What does Rosie do for a living?” → interpretive/transcript search.
- “how many films from 1980–1990” → metadata count by year range.

## Plan (Implementation)

### 1) Intent Layer (pre-classification)
Add a rule-based intent detector that runs before LLM classification.

**Intent types**
- metadata_latest (latest episode)
- metadata_current_season
- metadata_total_episodes
- metadata_year_range_count (e.g., 1980–1990)
- metadata_field_latest (mmmCount, thatsGreatCount)
- metadata_field_max (max of mmmCount / thatsGreatCount)
- transcript_only (entity/profile or “when did X join the discord”)
- none (fallback to existing classification)

This prevents factual aggregate queries from being treated as “unfiltered metadata” and incorrectly blocked.

### 2) Metadata Aggregations
Add deterministic functions in `metadata-store`:
- getLatestEpisode()
- getCurrentSeason()
- getTotalEpisodes()
- countByYearRange(min, max)
- getEpisodeWithMaxField(field)
- getFieldForLatestEpisode(field)

Each aggregation returns a structured metadata result + human-readable answer.

### 3) Field Synonym Mapping
Map natural language to metadata fields:
- “mmm” → mmmCount
- “that’s great” / “thats great” → thatsGreatCount

### 4) Transcript Routing Overrides
If intent is transcript_only, force transcript retrieval even if the LLM classifier says factual.

### 5) Response Templates
Use deterministic answers for metadata aggregates, e.g.:
- Latest episode: “The latest episode is …”
- Current season: “The podcast is currently on season …”
- Count totals: “There are N episodes…”
- Max field: “The episode with the most … is … (count: N).”

### 6) Validation / Regression
Turn the queries in `queries.md` into regression checks (manual for now).
Success criteria: each query returns the expected metadata or transcript answer without the “No matching episodes” message.

## Success Criteria
- All queries in `queries.md` return expected results.
- No “No matching episodes found” for queries that can be answered from metadata.
- Interpretive/entity questions trigger transcript search even when filters are empty.
- “Latest/current/total/max” questions return deterministic metadata answers.

## Phase B+ Expansion: Agent Routing for Host-Scoped Topic Queries (FM-21)

### Problem
"What does [host] say about [topic]" queries go through RAG interpretive path, which anchors on the most literal/dominant interpretation of the topic keyword. Misses episodes where the host made distinctive offhand remarks in a different context (e.g., "What does Haitch say about the English" → misses High Fidelity "Do English people know about music" quote).

### Deliverable: B11 Agent Routing Pattern
- Add new `AGENT_ROUTING_PATTERNS` entry matching "what does/did/has [host] say/said/think/thought about [topic]" patterns.
- Pattern: `/\bwhat\s+(does|did|has)\s+\w+\s+(say|said|think|thought)\s+(about|of|on)\b/i`
- High-volume: UC-4 analytics shows frequent "what has jason said about X" queries.
- Acceptance criteria:
  - "What does Haitch say about the English" returns High Fidelity source with music context.
  - "What has jason said about his dad" routes to agent and returns cross-episode results.
  - No regression on existing UC-3 single-episode queries that happen to contain "say about" (e.g., "what did Haitch say about the iconic one-liner from They Live" should still work — may need episode-scoped exception).
- Risk: over-routing UC-3 queries to agent. May need to exclude queries where `findFilmFromQuery()` detects a specific episode, limiting agent routing to genuinely cross-episode queries.

## Performance Regression
- `npm run perf:queries` runs a latency harness against `/api/search`.
- Set `PERF_BASE_URL` to target prod/staging.
