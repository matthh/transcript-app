# transcript-app — Claude instructions

Read `docs/ARCHITECTURE.md` first. It is the living overview of the app: purpose, stack, data ownership, query pipeline, all endpoints, deprecated paths, and known tech debt. Keep it updated whenever you change routing, endpoints, or data sources, and bump its "Last reviewed" date.

## Ownership rules
- This is a **fork of `jbennygold/transcript-app`**. Never push directly to `main`/`master`. All changes go on a branch and open a PR.
- The app reads episode metadata from a Google Sheet it does not own. Do not modify sheet structure without coordinating with the upstream owner.

## Key facts
- Dev port: **3000** (`npm run dev`).
- Episode metadata lives in `src/lib/metadata-data.ts` (baked at build time). Update via `npm run sync-metadata` + `npm run enrich-tmdb`.
- Vercel Blob is the production source of truth for transcripts, search indices, query logs, and feedback.
- All admin endpoints (`/api/transcribe`, `/api/transcripts/[episode]` PUT/DELETE, `/api/transcript-rename`) are currently **unauthenticated** — do not make them more accessible without adding auth (see AUDIT-2026-06-09.md).

## Deploy
- Push to `master` auto-deploys (Vercel).
- `NEXT_PUBLIC_BASE_URL` must be the canonical domain in prod for correct webhook and link construction.
