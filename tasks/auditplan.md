# Episode Coverage Audit — 2026-02-12

## Overview

| Source | Count |
|--------|-------|
| `metadata-data.ts` (app) | 297 entries (4 bonus + 293 regular, eps 1-293) |
| `episode-metadata.json` (raw) | 304 entries (11 bonus + 293 regular) |
| Local transcripts (`transcripts/`) | **300 files** after blob download (6 bonus + 1 ep_0 + 293 regular) |
| Local MP3s (`mp3s/`) | 84 files (ep 0 + 83 in range 206-293) |
| Production coverage | **100%** — 304 episodes, all have transcripts |

## Findings

### 1. Blob-only transcripts (not in local `transcripts/` folder) — RESOLVED

**78 transcripts downloaded from blob** on 2026-02-12 via `scripts/download-blob-transcripts.ts`.

Breakdown of what was missing:

| Group | Episodes | Notes |
|-------|----------|-------|
| Bonus catch-all | 0 | `episode_0.json` = "Silo Hugh Howey Interview" — blob's catch-all for one bonus ep |
| MP3 exists, never batch-transcribed | 206, 207, 209, 211, 212, 213 | Had local MP3s but no local transcript; blob had transcripts |
| Batch-transcribed, never saved locally | 208, 223-225, 227-272, 274-277, 279-281, 283-288, 290-293 | 66 episodes — batch script uploaded to blob but didn't write to `transcripts/` |

**Note:** Episode 169 was initially flagged as blob-only but this was a data extraction error — it IS committed to git and served from filesystem in production.

### 2. Episodes without local MP3s

**Old episodes (1-205):** None downloaded locally. Transcripts exist from earlier work.

**Missing from batch range (206-293):** 230, 273, 278, 282, 289
These 5 have blob transcripts but no local MP3 and no batch-progress entry — transcribed via interactive script or manual upload.

### 3. Local transcript gaps

**78 regular episodes** missing from `transcripts/`:

- **Early gaps (11):** 46, 48, 66, 88, 90, 92, 93, 95, 99, 119, 182 (episode 0 was in blob and is now downloaded)
- **Batch-range gaps (66):** 208, 223-225, 227-272, 274-277, 279-281, 283-288, 290-293

### 4. Metadata discrepancy: 304 vs 297

`episode-metadata.json` has 11 bonus entries (episode=0) but `metadata-data.ts` only includes 4. Seven bonus episodes in raw data are excluded from the app:

- S3: WarGames, Good Will Hunting
- S6: 1 Year Anniversary IMAX, Emergency DP2 Trailer, Silo Eps 1&2, Silo Hugh Howey
- S7: WGA-SAG Discussion

(S5 ON DECK Station Eleven, S5 Dune Special Edition, S7 DP2 Trailer 3, S7 Civil War are included.)

## Action Items

- [x] **#1 — Download blob-only transcripts locally.** 78 downloaded (0, 206-213, 223-225, 227-293). Local count: 222 → 300.
- [x] ~~**#2 — Commit & deploy episode 169.**~~ False alarm — already committed and filesystem-sourced in production.
- [x] **#3 — Source MP3s for missing episodes.** 230, 273, 278, 282, 289 all now in `mp3s/`. No missing MP3s in the batch range.
- [x] **#4 — Restore 11 early-gap episodes from git.** 46, 48, 66, 88, 90, 92, 93, 95, 99, 119, 182 were all committed but deleted from working tree. All restored via `git checkout HEAD --`.
- [x] **#7 — Rename 6 orphan bonus transcripts.** 03b1→49b1, 03b2→49b2, 05b1→79b1, 07b1→160b1, 07b2→175b1, 07b3→192b1. Updated episode_number inside each, renamed locally, uploaded to blob.
- [ ] **#8 — 4 bonus episodes missing MP3s and transcripts.** These need audio sourced and transcribed:
  - **100b1** — Dune (1965) EPISODE 1: SPECIAL EDITION (S5, 6/26/2022)
  - **103b1** — 1 Year Anniversary of the Dune IMAX Sneak Preview Event (S6, 7/21/2022)
  - **145b1** — BONUS: Emergency Dune Part Two Trailer Reactions (S6, 5/3/2023)
  - **146b1** — BONUS: Silo Episodes 1 & 2 (S6, 5/9/2023)
  - Note: Production coverage falsely shows these as covered due to fuzzy name matching (e.g. 100b1 matches episode_01).
- [x] **#5 — Assign unique IDs to all 11 bonus episodes.** Changed from `episode: 0` to `49b1`, `49b2`, `79b1`, `100b1`, `103b1`, `145b1`, `146b1`, `147b1`, `160b1`, `175b1`, `192b1`. Updated type to `number | string`, fixed all sort/comparison code, re-bundled. 304 entries in metadata-data.ts now. Build + typecheck pass.
- [x] **#6 — Rename `episode_0.json` to `episode_147b1.json`.** Renamed locally and in Vercel Blob. Updated `episode_number` inside JSON to `"147b1"`.
