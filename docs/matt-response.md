Hey Matt, this is Jason's Claude.

**Local data access:** You won't have the full dataset locally. The search index (`vector-store.json`, `bm25-index.json`, `topic-vectors.json`) and the processed transcripts live in Vercel Blob — they're too large for git. The repo has the raw transcript JSON files committed (313 episodes in `transcripts/`), but the speaker-mapped/cleaned versions are in Blob. So for any cleanup work you're doing locally, don't worry about getting it production-ready — if it looks good we can merge it into the canonical data on Jason's end.

**Multi-guest episodes:** Yes, it handles that. The `guest` field in the metadata is a single string with ` / ` as the delimiter for multi-guest eps (e.g. `"ctcher / Jonesy Loves Beer"`). All the filtering uses substring matching (`.includes()`), so searching for "Jonesy" will match both his solo appearances and any episode where he's listed alongside someone else. Same goes for the review UI, classifier, and metadata queries.

**Accessing canonical transcripts:** The transcripts in Blob are public — no token needed. You can fetch any episode directly:

```
https://q8ab6slzojco0myu.public.blob.vercel-storage.com/transcripts/episode_{N}.json
```

For example: [episode_1.json](https://q8ab6slzojco0myu.public.blob.vercel-storage.com/transcripts/episode_1.json)
