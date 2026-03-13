# Use Case Analytics — Design

**Date**: 2026-03-12
**Goal**: Classify every query by use case (UC-1 through UC-14) and provide an analytics page to view the distribution and drill into individual queries.

## Components

### 1. Deterministic Tagger (`src/lib/use-case-classifier.ts`)

Pure function, no async, no LLM. Called at log time to add `useCase` field to `QueryLogEntry`.

**Input**: query text + classification type + filters + intent + routing path + search strategy
**Output**: `UC-1` through `UC-14` or `unclassified`

Classification rules in priority order:

| Priority | Signal | UC |
|----------|--------|----|
| 1 | intent = `metadata_episode_lookup` | UC-1 |
| 2 | intent in [`metadata_latest`, `metadata_total_episodes`, `metadata_director_films`, `metadata_guest_search`, `metadata_current_season`, `metadata_field_latest`, `metadata_field_max`, `metadata_year_range_count`, `metadata_year_range_sample`, `metadata_episode_fields`] | UC-2 |
| 3 | intent = `metadata_tilda` or query matches tilda/full-catalog patterns | UC-14 |
| 4 | routingPath = `agent_search` + counting/frequency regex | UC-9 |
| 5 | routingPath = `agent_search` (other) | UC-6 |
| 6 | query matches voicemail/segment keywords (truthsayer, birria, kev, corey, voicemail, letter, segment, animal mother, mr java, lizzen) | UC-8 |
| 7 | query matches catchphrase/recurring keywords (catchphrase, recurring phrase, always says, signature line) | UC-10 |
| 8 | query contains quote markers, "which episode" + specific phrase, or "what did X mean when" | UC-11 |
| 9 | filters.guest present + interpretive/hybrid | UC-13 |
| 10 | personal/lifestyle keywords (food, BBQ, fishing, shorts, looks like, favorite food, what does X look like, pets) | UC-7 |
| 11 | filters.film present + interpretive/hybrid | UC-3 |
| 12 | host name in query + no film filter + interpretive | UC-4 |
| 13 | factual + filters + requiresTranscriptDepth | UC-12 |
| 14 | interpretive/hybrid + no specific entity filter | UC-5 |
| 15 | fallback | `unclassified` |

### 2. Batch LLM Classifier (`scripts/classify-query-logs.ts`)

Retroactively classifies existing logs with Haiku for higher accuracy.

- Lists all blobs under `query-log/` prefix
- For each entry without `useCaseLLM`, calls Haiku with query text + logged signals + UC definitions
- Writes `useCaseLLM` field back to same blob path (merged JSON overwrite)
- Idempotent — skips entries already tagged
- Rate limited with progress logging
- Batch size configurable, default processes all months

### 3. Schema Changes (`src/lib/query-logger.ts`)

Add two fields to `QueryLogEntry`:

```typescript
useCase?: string;      // Deterministic tag, set at log time
useCaseLLM?: string;   // LLM tag, set by batch script
```

### 4. API Endpoint (`GET /api/analytics/use-cases`)

Query params:
- `month` — optional, defaults to current month. Use `all` for all time.
- `useCase` — optional, filter to specific UC for drill-down.

Response shape:
```json
{
  "distribution": [
    { "useCase": "UC-3", "label": "Single-Episode Opinion", "count": 142, "percent": 34.2 }
  ],
  "totalQueries": 415,
  "period": "2026-03",
  "queries": []
}
```

`queries` array populated only when `useCase` param is set (drill-down mode). Each entry: `{ id, query, useCase, timestamp, rating, routingPath }`.

Use case resolution: prefer `useCaseLLM` when present, fall back to `useCase`.

### 5. Analytics Page (`/analytics`)

Uses existing app styling. Components:

- **Month selector** — dropdown, defaults to current month, includes "All time"
- **Distribution table** — UC label, count, percentage, bar visualization
- **Drill-down** — click a UC row to expand/navigate to query list for that UC
- **Query list** — query text, timestamp, rating badge, routing path. Sorted by recency.

No auth (matches rest of app).

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/use-case-classifier.ts` | **Create** — deterministic classifier |
| `src/lib/query-logger.ts` | **Modify** — add `useCase` + `useCaseLLM` fields |
| `src/app/api/search/route.ts` | **Modify** — call classifier, pass to logQuery |
| `src/app/api/search/stream/route.ts` | **Modify** — call classifier, pass to logQuery |
| `scripts/classify-query-logs.ts` | **Create** — batch LLM classifier |
| `src/app/api/analytics/use-cases/route.ts` | **Create** — analytics API |
| `src/app/analytics/page.tsx` | **Create** — analytics page |

## Non-Goals

- No auth on analytics page (can add later)
- No real-time streaming updates
- No export/CSV download (can add later)
