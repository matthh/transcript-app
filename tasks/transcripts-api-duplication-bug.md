# `/api/transcripts` duplication bug

**Date found:** 2026-04-20
**Endpoint:** `GET https://search.escapehatchpod.com/api/transcripts`
**Severity:** Low — duplicates are exact copies, so naive consumers get the right data twice, not stale/conflicting data. Clients must dedupe by `episode_number`.

## TL;DR

The endpoint returns **311** entries, but only **306** are unique by `episode_number`. Episodes **1, 2, 3, 4, 5** each appear twice. All other episodes appear once.

## Reproduction

```sh
curl -s https://search.escapehatchpod.com/api/transcripts > /tmp/list.json

node -e '
  const a = require("/tmp/list.json");
  const counts = {};
  for (const e of a) {
    counts[e.episode_number] = (counts[e.episode_number] || 0) + 1;
  }
  console.log("total:", a.length);
  console.log("unique:", new Set(a.map(x => x.episode_number)).size);
  console.log("dupes:", Object.entries(counts).filter(([,n]) => n > 1));
'
```

Output:
```
total: 311
unique: 306
dupes: [["1",2],["2",2],["3",2],["4",2],["5",2]]
```

The two entries for each of eps 1–5 are byte-identical:
```json
{"filename":"episode_1","episode_number":1,"episode_name":"Dune (1965) Part 1","dialogueCount":248,"hasAudio":true}
{"filename":"episode_1","episode_number":1,"episode_name":"Dune (1965) Part 1","dialogueCount":248,"hasAudio":true}
```

## Expected

306 entries total (one per unique `episode_number`).

## Probable root cause

`src/lib/blob-storage.ts` → `listBlobTranscripts()` lists every blob under the `transcripts/` prefix, filters out `transcripts/raw/`, and maps each remaining blob to a metadata entry. It does **not** dedupe by `episode_number`.

`saveTranscript()` today uses `addRandomSuffix: false, allowOverwrite: true`, so current saves collapse onto a single pathname per episode. But earlier saves of eps 1–5 likely happened before that flag was added (or via a different code path), producing additional blobs like `transcripts/episode_1-<random>.json` alongside the canonical `transcripts/episode_1.json`. Both pass the `.endsWith('.json') && !startsWith('transcripts/raw/')` filter, so both are returned, and the API route in `src/app/api/transcripts/route.ts` pushes both into the response array.

The pattern — **exactly episodes 1–5**, all the oldest — is consistent with a historical upload path that predated the `addRandomSuffix: false` fix.

## Suggested fixes

Pick one (or combine):

1. **Dedupe in `listBlobTranscripts()`** — group by the episode_number regex match and keep the most recent `uploadedAt`. One-line fix, preserves stale blobs but hides them from callers.

2. **Dedupe in `/api/transcripts/route.ts`** — same logic but scoped to the route. Leaves `listBlobTranscripts()` as a raw lister for internal callers that want to see all blobs.

3. **Clean up the blob store** — enumerate `transcripts/`, identify random-suffixed duplicates of canonical names, `del()` the duplicates. Permanent fix; eliminates the ambiguity. Worth doing once since the affected set is small (likely 5 stale blobs).

Option 3 is the cleanest if you're confident the random-suffixed blobs are strictly stale copies; 1 or 2 is the safer short-term patch.

## Downstream impact

Consumers that currently rely on this endpoint should dedupe by `episode_number` until this is fixed. Known consumers: Escape-Hatch Explore (via `EH_SEARCH_URL`), and any future Claude skill / producer agent pulling the episode list.

## Not affected

- `/api/transcripts/{episode_number}` — per-episode endpoint works correctly (returns a single transcript for each of 1–5, same content either way).
- Search / query endpoints — they operate on loaded transcripts by episode number, and `loadTranscript()` resolves to a single blob via pathname prefix lookup, so duplicates don't leak into search results.
