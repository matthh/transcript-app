# External Search API

Stable, documented seam for third-party consumers (e.g. Escape Hatch Explore) to
use the transcript-grounded search without touching internal endpoints.

## Endpoint

```
POST https://search.escapehatchpod.com/api/external/search
```

The internal `/api/search` route is **not** part of this contract — its shape
may change. External consumers must use `/api/external/search`.

## Request

```http
POST /api/external/search
Content-Type: application/json
x-eh-key: <shared secret>

{
  "query": "what does Rosie Knight think about Twilight on Escape Hatch",
  "limit": 8
}
```

| Field   | Type    | Required | Notes                                               |
| ------- | ------- | -------- | --------------------------------------------------- |
| `query` | string  | yes      | Natural-language question. Max 2000 chars.          |
| `limit` | number  | no       | Max sources to return. Default 8, capped at 20.     |

No other fields are accepted — `depth`, `variant`, `offset` are internal only.

## Response (200)

```json
{
  "answer": "…synthesized answer, markdown-safe plain text",
  "sources": [
    {
      "episodeNumber": 152,
      "episodeTitle": "…",
      "episodeUrl": "https://open.spotify.com/episode/…",
      "quote": "…",
      "timestamp": 1847
    }
  ],
  "attribution": {
    "text": "Powered by search.escapehatchpod.com",
    "url": "https://search.escapehatchpod.com"
  },
  "requestId": "ql_…"
}
```

**Stable fields** (safe to parse):
`answer`, `sources[].episodeNumber`, `sources[].episodeTitle`,
`sources[].episodeUrl`, `attribution`, `requestId`.

Optional per source:
`quote` (absent for metadata-only answers), `timestamp` (seconds into episode).

Sources are deduped by `episodeNumber`. Transcript sources appear before
metadata-only sources when both exist.

## Errors

| Status | Meaning                                                              |
| ------ | -------------------------------------------------------------------- |
| 400    | Invalid JSON, missing/empty `query`, or `query` exceeds 2000 chars   |
| 401    | Missing or invalid `x-eh-key`                                        |
| 429    | Rate limit exceeded — respect `Retry-After` header                   |
| 5xx    | Server-side failure; retry with backoff                              |

Error body: `{ "error": "…", "retryAfterSec"?: number }`.

## Auth

Shared secret in `x-eh-key` header. One key per consumer (label:secret pairs
configured via `EH_EXTERNAL_KEYS`). Keys can be revoked without rotating others.

**Server-to-server only.** Do not ship keys to browsers.

## Rate limits

Per key, per serverless instance (see in-memory caveat below):

- Short: 60 requests / 10 minutes
- Long:  500 requests / 24 hours

`429` responses include `Retry-After` in seconds.

### Consumer obligations

- Cache `{answer, sources}` by normalized query (lowercase, trimmed, collapsed
  whitespace) for **≥ 10 minutes**.
- Debounce user input by **≥ 400 ms** before firing a request.

## Stability guarantees

- Request and response shapes at `/api/external/search` are stable.
- Breaking changes ship as `/api/external/v2/search` with at least **60 days**
  of overlap.
- New optional response fields may appear at any time; consumers must tolerate
  unknown fields.

## Attribution

Consumers must render the `attribution` block (or its equivalent link) wherever
an answer derived from this endpoint is displayed.

## Internal implementation notes

- Route handler: `src/app/api/external/search/route.ts`
- Auth:         `src/lib/external-auth.ts`
- Rate limit:   `src/lib/external-rate-limit.ts` (in-memory — see TODO below)
- Transformer:  `src/lib/external-response.ts`
- Pipeline:     `src/lib/search-pipeline.ts` (shared with internal `/api/search`)

### TODO: replace in-memory rate limiter

The current limiter is per-lambda-instance. Accurate only for single-consumer
low-traffic use. Swap to Upstash or Vercel KV when:

- Multiple consumers onboard, or
- A consumer's fan-out × per-instance limit exceeds the intended global cap.

Drop-in swap: replace `checkRateLimit` with an `@upstash/ratelimit` sliding
window backed by Redis, keep the same `RateLimitResult` shape.

### Cost attribution

External requests are tagged in `QueryLogEntry` with
`source: 'external'` and `externalKeyId`. Filter query logs by `source` to
isolate external cost.
