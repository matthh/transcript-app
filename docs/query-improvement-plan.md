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

## Performance Regression
- `npm run perf:queries` runs a latency harness against `/api/search`.
- Set `PERF_BASE_URL` to target prod/staging.
