# Query Failure Modes

This document defines the most common ways search queries fail in the current architecture, including:
- query classes that are intrinsically hard with the current pipeline,
- predictable operational misses we should expect,
- where each failure originates (routing, retrieval, synthesis, metadata, or eval coverage).

It is intended to be used with:
- `docs/query-journey.md` (how the pipeline works),
- `docs/query-failure-triage.md` (how to triage incidents),
- `planv4.md` (how fixes are sequenced).

## How To Use This Document

For each reported bad query:
1. Find the nearest failure mode below.
2. Confirm stage-level root cause in triage.
3. Add or update an eval case for that mode.
4. Map remediation to the corresponding `planv4` phase.

## Failure Mode Taxonomy

### FM-01: Intent/Classification Misroute
- Stage: Routing
- Query type: ambiguous factual vs interpretive/hybrid
- Why hard now: short or overloaded phrasing can look metadata-answerable while actually requiring transcript evidence.
- Common miss: query sent to metadata fast-path, returns thin or wrong answer.
- User-visible symptom: confident but incomplete answer, or irrelevant metadata list.
- Plan alignment: Phase 1 (routing guardrails), Phase 4 (routing assertions).
- Phase 1 mitigations shipped:
  - Medium-confidence intents skip metadata fast-path, fall through to full pipeline.
  - Low-confidence classifications (< 0.6) with no filters force hybrid handling.
  - Quick synthesis restricted to factual queries without `requiresTranscriptDepth`.

### FM-02: Endpoint Drift (`/api/search` vs `/api/search/stream`) — MITIGATED
- Stage: Routing/Policy
- Query type: any
- ~~Why hard now: duplicated logic can diverge subtly over time.~~
- Common miss: same query yields different routing, depth, or result quality by endpoint.
- User-visible symptom: UI answer differs from non-stream API answer.
- Plan alignment: Phase 1 (shared policy), Phase 4 (endpoint parity assertions).
- Phase 1 resolution: shared routing policy module (`src/lib/routing-policy.ts`) centralizes all routing decisions (`shouldSkipMetadataAggregate`, `shouldForceHybridClassification`, `shouldUseQuickSynthesis`, constants, `episodeToMetadataSource`). Both endpoints import from this module. Presentation-layer duplication (Tilda/notable-moments formatting) remains but is expected (JSON vs SSE).
- Residual risk: future changes could re-introduce drift if new routing logic is added inline instead of via the shared module. Phase 4 endpoint parity assertions will guard against this.

### FM-03: Filter Extraction Failure — PARTIALLY MITIGATED
- Stage: Classification -> Metadata retrieval
- Query type: factual/hybrid with entities (film/guest/director/genre)
- Why hard now: extraction errors or generic token extraction can overconstrain/underconstrain search.
- Common miss: no metadata matches, wrong film/person picked, fallback too broad.
- ~~Example: episode-id lookup misses such as “what episode is 283” or “give me details about episode 283”.~~ **Resolved in Phase 1** — dedicated `metadata_episode_lookup` intent now handles these patterns deterministically.
- ~~New examples from production eval (2026-02):~~
  - ~~”What did Matt Haitch say about ... in the Malcolm and Marie episode” → retrieval returned Station Eleven chunks.~~
  - ~~”What did Mark Altman say about Decker in the Star Trek episode” → retrieval returned Real Genius chunks.~~
  - ~~”What did Haitch say about the iconic one-liner from They Live” → 36 sources from 12 unrelated episodes.~~
- **Resolved in Phase 2d** — all three examples above now pass consistently. Two fixes shipped:
  1. **Episode-scoped retrieval injection** (`injectTargetedEpisodeChunks`): when the classifier identifies 1–3 target episodes, a separate episode-scoped embedding search runs against only those episodes' chunks, then injects missing results into the main pipeline at median score before keyword/episode boosts.
  2. **Deterministic film filter fallback** (`findFilmFromQuery`): when the LLM classifier fails to extract a film name (common for short/ambiguous titles like “They Live”), a deterministic catalog lookup runs as a safety net.
  3. **Episode title normalization** (`normalizeEpisodeTitle`): metadata film field includes year suffixes (e.g., “They Live (1988)”) but chunk episodeTitle may not. All comparison points now strip `(YYYY)` from both sides before matching.
- User-visible symptom: “no matches” where known matches exist, or wrong episode set.
- Plan alignment: Phase 5 (canonicalization + matching tiers), Phase 4 tests.
- **Director-name routing**: `findDirectorFromQuery()` + `metadata_director_films` intent now handles "what [director] movies/films" listing queries deterministically. When the query contains a listing verb + film/episode noun and a catalog director name (≥4 char last name match), the query is routed to the metadata fast-path which returns all episodes for that director. Addresses F9 ("what villeneuve movies have been episodes").
- Residual risk: queries referencing films not in the episode catalog (typos, alternate titles) still rely on embedding similarity alone. Queries matching >3 episodes skip injection (guarded to avoid over-constraining broad queries).

### FM-04: Sparse Retrieval Miss for Transcript-Depth Factual Queries — MOSTLY MITIGATED
- Stage: Retrieval
- Query type: phrase lookup, quote lookup, biography-like host questions, frequency/ranking queries
- Why hard now: top-K chunk retrieval may not include the decisive evidence.
- Common miss: synthesis concludes “not found” despite evidence elsewhere in corpus.
- User-visible symptom: false negative on known in-transcript facts.
- Plan alignment: Phase 2a (context expansion, dedup), Phase 2b (rerank), Phase 2c (remaining), Phase 4 recall assertions.
- Phase 2a mitigations shipped:
  - `expandAdjacentChunks()` appends ±1 neighbor chunks for keyword-matching results at 0.5× parent score. Fixes cases where the entity mention and the connected anecdote are in adjacent chunks (e.g., Joe Eszterhas).
  - `deduplicateChunks()` removes near-duplicate chunks (Jaccard ≥ 0.6), freeing slots for diverse evidence.
  - `suppressBoilerplate()` downranks outro/credits chunks, promoting substantive content.
- Phase 2b mitigations shipped:
  - `rerankChunks()` — LLM reranking via Haiku reorders top-N chunks by semantic relevance, catching cases where lexical/embedding scores don't reflect actual query match quality. Skipped for ≤5 results; 5s timeout fallback.
- Phase 2c mitigations shipped:
  - Reranker omissions honored — chunks the LLM omits as "clearly irrelevant" are now actually dropped instead of silently re-appended.
  - Keyword-centered excerpt extraction — `extractRelevantExcerpt()` centers the 600-char reranker excerpt window where query keywords cluster, so the LLM sees relevant content even in long (8K+) chunks. Previously, blind first-600-char truncation hid key phrases from the reranker.
  - Fixes "digital court jew" failure: 41 keyword-matching chunks from 13 episodes → 2 relevant chunks from 1 episode after reranking.
- Phase 4 mitigation shipped:
  - **BM25 Whisper transcription error synonyms** (`src/lib/bm25.ts`): "Joe Eszterhas" is transcribed by Whisper as "Jo Esther house" / "Ester houses" / "Esther House". Added synonym entries: `eszterhas`/`esterhaus` (with and without apostrophe) → `["esther", "ester"]`. Bridges the transcription error so BM25 can match these Showgirls episode chunks.
  - Joe Eszterhas anecdote linkage eval case now passes consistently (was flaky).
- **Best-of / original version disambiguation**: When an episode has both an original (e.g., S6E119 Galaxy Quest) and a best-of rebroadcast (S8E235 Best of: Galaxy Quest), queries specifying "original version" can intermittently miss. The modifier "original version" adds noise to embedding search, and "Twitter" is a weaker retrieval signal than "elon musk" for the same content. Observed: "what was said about Twitter in the Galaxy Quest episode, original version" returned false denial ("no mentions of Twitter"), while "what is in the galaxy quest episode that mentions elon musk" succeeded — same content, different retrieval stability. Non-reproducible on subsequent attempts; classified as intermittent retrieval non-determinism exacerbated by query noise.
- **Segment-scoped retrieval failures** — **RESOLVED via segment sub-chunking**: Queries asking about specific podcast segment types (truthsayer, birria, kev, corey, etc.) previously failed because RAG retrieved general episode discussion containing the topic keyword rather than actual segment content. Two observed cases:
  - "is there a truthsayer or birria segment with a rollerskating monkey" — content exists in episode 140 (Close Encounters) birria truthsayer ("orangutan...roller skates") but RAG returned Rollerball/Aspen Extreme instead.
  - "Which Truthsayer segments have had to do with Cocaine?" — Jaws episode (212) truthsayer mentions Dennis Quaid "aggressively using cocaine in every scene" of Jaws 3D. RAG returned 11 sources from 10 unrelated episodes.
  - **Fix**: segment sub-chunking (`scripts/ingest.ts`): `extractSegmentChunks()` creates dedicated sub-chunks for 6 recurring voicemailer segments (Truthsayer/Birria, Kev, Corey, Animal Mother, Mr Java, Lizzen). Each sub-chunk gets a semantic prefix (e.g., `[Recurring segment: Truthsayer / Birria voicemail]`) so embedding/BM25 can match "truthsayer" queries to actual truthsayer content. Chunk IDs use `_3000+` offset. Boundary detection: segment starts at first voicemailer speaker turn, ends after 5 consecutive non-voicemailer turns. Large segments split at ~600 tokens. BM25 synonyms bridge "truthsayer"↔"birria" and segment name variants.
- **Distinctive phrase existence queries**: "is there a truthsayer or birria segment with a rollerskating monkey" — the content exists in episode 140 (Close Encounters) birria truthsayer: "an orangutan dressed in a specially made gray spandex suit strapped to roller skates." RAG failed because: (1) "rollerskating monkey" is a novel compound not in any chunk verbatim — the transcript says "orangutan...roller skates" across sentences, (2) embedding similarity between the query and the truthsayer chunk is weak due to the unusual topic. Agent grep for `roller.*skat` + `monkey|orangutan` in truthsayer segments would find it instantly. This is a candidate for a new agent routing pattern: existence/search queries with distinctive phrases (e.g., "is there a segment with/about/where X").
- **Synthesis false denial with evidence present**: "Which episode of the pod featured The Witch (when Haitch lost his voice)?" — ep 129 (Watch Talk) retrieved as a source, chunk contains "he lost his voice", "I don't have a voice", and "old witch" references. But synthesis denied any information existed. Compound failure: (1) "The Witch" doesn't match any film in the catalog — episode film field is "EMERGENCY EP - Watch Talk (2023)" — so no episode scoping fires; (2) Whisper speaker labels are all "?" in ep 129, preventing synthesis from connecting "he" to Haitch; (3) chunk 0 (0:02-7:41) where Haitch explicitly says "I got really sick and completely lost my voice" was not retrieved — only chunk 2 (14:02-21:53) with indirect third-person narration. Topic vector for chunk 0 captures "Matt lost his voice after getting sick" but the query term "The Witch" doesn't match that topic embedding. Primary failure: synthesis false denial + retrieval gap (chunk 0 missed). Secondary: metadata gap ("The Witch" discussed as a pod-first but isn't the episode's film title).
- Residual risk: anecdotes spanning >2 chunks or cases where entity mention is far from the evidence. Paraphrased re-broadcast duplicates below Jaccard 0.6 still consume slots. Other Whisper transcription errors for proper names may exist undiscovered. Note: blanket best-of suppression was removed because Jaccard dedup + diversification adequately handle rebroadcast content, and the score penalty was crushing unique intro/outro content in best-of episodes (e.g., episode 296's AI/coding discussion).

### FM-18: Episode Identification via Non-Title Details
- Stage: Retrieval + Synthesis
- Query type: "which episode" queries that identify an episode by incidental details (personal events, running jokes, non-primary film discussed) rather than the episode's canonical film title.
- Why hard now: `findFilmFromQuery()` only matches the episode's film title field. When a user references a film discussed as a sidebar ("pod-first"), a personal event ("when Haitch lost his voice"), or a running joke ("The Witch" as a nickname for Haitch's raspy voice), there's no route to the correct episode. The metadata `notableMoments` field may contain the answer (e.g., "Pod-First - The Witch! Haitch does not host due to illness") but it's not searched during retrieval.
- Common miss: correct episode's chunks may be retrieved via BM25/embedding keyword match, but (1) the most direct chunk is often not top-ranked, and (2) synthesis can't determine the episode identity from indirect evidence because Whisper speaker labels are unreliable.
- User-visible symptom: "no information" despite the episode existing and containing exactly the referenced content.
- Example: "Which episode of the pod featured The Witch (when Haitch lost his voice)?" → ep 129 (EMERGENCY EP - Watch Talk). Film field doesn't contain "The Witch." Metadata notable moments says "Pod-First - The Witch! Haitch does not host due to illness." Transcript chunk 0 has Haitch saying "I got really sick and completely lost my voice." Synthesis denied information existed.
- Proposed mitigations:
  1. **Notable-moments retrieval**: Index `notableMoments` field for BM25/embedding search alongside transcript chunks. Would match "The Witch" + "lost his voice" directly.
  2. **Pod-first film indexing**: Extract pod-first film mentions from `notableMoments` and add as secondary film titles for the episode. Would let `findFilmFromQuery()` route "The Witch" to ep 129.
  3. **Metadata text search**: Add a metadata text search pass that checks query terms against `notableMoments`, `hFlex`, `jFlex`, and `kevsQuestion` fields.
- Plan alignment: Phase 5 (metadata quality and freshness).

### FM-05: Windowed Frequency Comparison Failure — MOSTLY MITIGATED
- Stage: Retrieval/Analysis
- Query type: “first N vs last N”, “who says X more”, phrase counts across explicit windows
- Why hard now: these are counting tasks; sampling/ranked retrieval is not a reliable counting substrate.
- Common miss: one window underrepresented, wrong winner, or false zero in recent/older windows.
- User-visible symptom: incorrect comparative claim (“none in last 100”).
- Plan alignment: Phase 2 (deterministic window analysis), Phase 4 gold-count assertions.
- Phase 6 partial mitigation: Agent search path handles counting/frequency queries with verb anchors (e.g., “how many times does Jason say X”). The agent greps raw transcripts and counts occurrences systematically.
- Phase B mitigations shipped: B1 (speaker comparison — “who says X more”) and B2 (windowed comparison — “first/last N episodes” + comparison word) now route to agent. Covers user-reported failure F5 (“Has Haitch said 'we'll get there' more in the last 100 episodes or the first 100”).
- Residual risk: Phase A verb allowlist is narrow — queries using action verbs outside `(say|said|mention|mentioned)` (e.g., “how many times has Haitch **interrupted** a guest with 'we'll get there'”) bypass agent routing and fall to RAG, which returns irrelevant chunks and false-negative synthesis. 91 transcript matches exist for “we'll get there” but the verb “interrupted” isn't in the Phase A gate. Fix: expand verb set in Phase A pattern (add `interrupted`, `used`, `asked`, `told`, `brought up`, etc.).

### FM-06: Cross-Episode Aggregation Failure — MOSTLY MITIGATED
- Stage: Retrieval + Synthesis
- Query type: trait/persona summaries and “what do we know about X and Y”
- Why hard now: evidence is distributed across episodes and may not co-occur in a single chunk.
- Common miss: answer says “no information” despite scattered supporting evidence.
- User-visible symptom: flat denial where partial/qualified synthesis was possible.
- Plan alignment: Phase 2a (dedup frees episode slots), Phase 2b (entity-aware retrieval), Phase 3 (aggregation policy), Phase 4 assertions.
- Phase 2a mitigations shipped: dedup removes near-duplicate chunks that inflate per-episode counts, freeing slots for more diverse episodes. Boilerplate suppression prevents outro chunks from consuming episode slots.
- Related example: ~~”If Jason had a catchphrase” — retrieval surfaces meta-discussion of film catchphrases instead of cross-episode evidence of Jason's recurring speech patterns.~~ **Resolved in Phase 5** — see FM-16 (now resolved via catchphrase sub-chunking + supplemental query expansion).
- Phase 6 partial mitigation: Agent search path handles counting/frequency aggregation queries (e.g., “How many times does Jason say big time?”). Agent greps raw transcripts exhaustively across all 300 episodes.
- Phase B mitigations shipped: Seven new routing patterns now route broader aggregation queries to agent:
  - B3 (exhaustive listing — “list/name all/every” + utterance verb): covers F1 (“list all props talked about buying”)
  - B4 (temporal ordering — “earliest/first mention of”): covers F11 (“earliest mentions of Jodorowsky”)
  - B5 (frequency ranking — “most frequent/common/repeated” + noun): covers F7 (“most oft-repeated terms or phrases”)
  - B6 (episode counting — “how many episodes mention/discuss”): covers episode-level counting
  - B7 (multi-episode entity extraction — “N episodes prior/before/after”): covers F13 (“voicemails in Midsommar and 4 episodes prior”)
  - B1/B2 also help (see FM-05)
- **B3 routing gap — “what are all” variant** (FIXED): B3 widened to include `(what are|what were|find)` triggers and passive verbs `(called|described|referred to|labeled)`.
- **B3b routing gap — noun forms** (FIXED): B3 only matched verb forms ("what are all ... mentioned/discussed") but missed noun forms ("what are all the mentions/references of X"). Added B3b pattern for noun-form exhaustive listing. Example: "what are all the mentions of the podcast The Watch" was classified as `factual` and sent to metadata fast-path (found nothing). Now routes to agent.
- **B8 (shipped)**: Cross-episode mention context — “in what context has X been mentioned/discussed”, “was X ever mentioned”, “are there any mentions of X”. Routes entity-tracking existence queries to agent for exhaustive transcript search.
- **B10 (shipped)**: Episode/segment quote finder — “which episode/segment did X say Y”. Routes verbatim phrase-finding queries to agent grep.
- Residual risk: queries without utterance verbs (e.g., “what villeneuve movies have been episodes”) stay on RAG — these are metadata-answerable. Persona aggregation (“What does Jason think of fishing”) stays on RAG — handled by sub-chunks and supplemental queries.

### FM-07: Role Attribution Error (Host vs Guest vs Voicemailer) — PARTIALLY MITIGATED
- Stage: Synthesis (with retrieval contributors)
- Query type: person-scoped prompts ("Did Haitch...", "What did Corey...")
- Why hard now: chunks often contain multiple speakers; role constraints are weak. Transcript speaker labels can be inaccurate (whisper transcription errors).
- Common miss: guest quote attributed to host, or vice versa. Synthesis invents generic speaker labels ("host B", "host C").
- User-visible symptom: wrong person credited for claim, or generic labels instead of names.
- Examples from production eval (2026-02):
  - Nemek's manifesto (Andor): answer attributes Jason's quote to Haitch — likely transcript speaker labeling error.
  - Villeneuve across Arrival/Sicario: synthesis output contained "host B" and "host C" instead of proper names.
- Plan alignment: Phase 3 (role-aware attribution), Phase 4 role assertions.
- Partial mitigation shipped: `HOST_IDENTITY_RULE` in all synthesis prompts declares exactly two hosts (Haitch and Jason), normalizes "Matt Haitch" → "Haitch" at data level, and tells the LLM all other speakers are guests/reviewers/voicemailers. Fixes the "host B/C" generic label problem. Does not fix underlying transcript speaker labeling errors.

### FM-08: Episode Attribution Error
- Stage: Synthesis
- Query type: "what episode", citation-heavy factual responses
- Why hard now: synthesis can blend details from separate chunks/episodes.
- Common miss: details from episode A labeled as episode B.
- User-visible symptom: wrong episode cited for a true quote/detail.
- Plan alignment: Phase 3 attribution integrity checks, Phase 4 attribution assertions.

### FM-09: Medium Contamination (Film vs TV)
- Stage: Retrieval + Synthesis
- Query type: TV-only or film-only queries
- Why hard now: lexical overlap plus weak medium constraints.
- Common miss: TV query returns film evidence (or inverse) unless user is very explicit.
- User-visible symptom: off-target recommendations/examples.
- Plan alignment: Phase 2 medium-aware retrieval, Phase 4 medium assertions.

### FM-10: Boilerplate/Outro Dominance — MITIGATED
- Stage: Retrieval
- Query type: lexical phrase queries, trait/persona queries
- ~~Why hard now: recurring credits/outro text can dominate lexical matches.~~
- Common miss: high-ranked chunks are repetitive boilerplate, not semantic evidence.
- User-visible symptom: answer anchored on repetitive show boilerplate.
- Plan alignment: Phase 2a boilerplate suppression, Phase 4 noise-focused assertions.
- Phase 2a resolution: `suppressBoilerplate()` matches 6 regex patterns for recurring outro/credits language. 2+ pattern matches → 0.3× score penalty; 1 match → 0.6× penalty. Chunks are not removed (still findable if directly queried), just downranked.
- Residual risk: boilerplate with novel phrasing not covered by the 6 patterns could still rank highly.

### FM-11: Weak-Evidence Overclaim
- Stage: Synthesis
- Query type: favorites, strongest opinions, comparative judgments
- Why hard now: model pressure to answer definitively even with sparse evidence.
- Common miss: “favorite/all-time” claim based on one mention.
- User-visible symptom: overconfident preference claim.
- Plan alignment: Phase 3 evidence-threshold policy, Phase 4 preference assertions.

### FM-12: Fast-Path Dead-End or Thin Fallback
- Stage: Routing/Fallback
- Query type: metadata-intent queries with partial mismatches
- Why hard now: fast-path may trigger without robust fallback rationale.
- Common miss: terse unhelpful output instead of fallback full pipeline + explanation.
- ~~Example: explicit episode-number questions fail to return metadata details and instead degrade into weak transcript-only responses.~~ **Resolved in Phase 1** — `metadata_episode_lookup` intent returns a deterministic summary; falls through to full pipeline when episode not found.
- User-visible symptom: abrupt “no result” or low-context answer.
- Plan alignment: Phase 1 fast-path fallthrough guardrails, Phase 4 routing assertions.
- Phase 1 mitigations shipped: medium-confidence intents bypass fast-path entirely; all fast-path misses log structured reason and fall through.

### FM-13: Ambiguous Term Scope Narrowing in Synthesis — RESOLVED
- Stage: Synthesis
- Query type: single-word or short queries where the term has multiple referents across transcripts (person name, franchise, character, etc.)
- Why hard now: synthesis model latches onto the most "obvious" interpretation (e.g., Zelda = video game) and ignores other valid referents (e.g., Zelda Rubinstein the actress, Madame Zelda story) even when evidence for those referents is present in the provided sources.
- Common miss: answer discusses only one interpretation despite sources containing multiple distinct referents; concludes with false denial about other referents.
- User-visible symptom: answer feels incomplete — user knows the term appears in more contexts than the answer covers.
- Examples:
  - ~~Query "Zelda" — retrieval finds 4 episodes with mentions (video game, Zelda Rubinstein actress, Madame Zelda Nathan Lane story, Zelda character in Southland Tales) but synthesis only discusses the video game reference and says "I don't have information about any Legend of Zelda films."~~ **Resolved in Phase 4** — Zelda now consistently returns Zelda Rubinstein across Poltergeist + Southland Tales. The "Breath of the Wild" incidental voicemail mention was removed from eval assertions as an unreasonable bar for a 1-word query.
  - ~~Query about "the Mark" of the podcast (referring to Mark Borchardt from American Movie) — retrieval doesn't surface American Movie episode chunks (cultural reference "the Mark" doesn't match on embedding/keyword similarity).~~ **Resolved in Phase 5** — full re-ingest with ~300 transcripts (4848 chunks) improved coverage; American Movie chunks now surface for "the Mark" queries.
- Phase 3a partial mitigation shipped: grounding rule #10 (MULTI-REFERENT COVERAGE) requires synthesis to address all distinct referent clusters found in sources. Helps when sources already contain multiple referents, but doesn't fix retrieval gaps (e.g., "the Mark" case where the right chunks aren't retrieved at all).
- **Phase 5 resolution**: Full corpus re-ingest (3131→4848 chunks) with catchphrase and personal-aside sub-chunking improved overall retrieval coverage. Both the Zelda and "the Mark" cases now pass consistently.
- Plan alignment: Phase 3 (further synthesis grounding), Phase 4 (multi-referent assertions).

### FM-14: Synthesis Implicit Knowledge Gap — MITIGATED
- Stage: ~~Synthesis~~ Classification/Retrieval (reclassified)
- Query type: questions that require connecting facts across the query and the retrieved sources using world knowledge (e.g., "Wachowskis' debut" requires knowing Bound is their debut).
- ~~Why hard now: synthesis only sees chunk text and the query; if the query uses a description (e.g., "directorial debut") rather than the film title, and the chunks don't explicitly state the connection, synthesis cannot bridge the gap.~~
- ~~Common miss: correct episode chunks are retrieved but synthesis says "no information" because it doesn't make the implicit connection.~~
- Phase 3a partial mitigation: grounding rule #9 (IMPLICIT KNOWLEDGE BRIDGING) instructs synthesis to use world knowledge to connect query descriptions to source content.
- **Phase 4 resolution**: `findDebutFilmFromQuery()` in `query-intent.ts` resolves "directorial debut" / "first film" patterns at classification time. Detects debut concept in query, searches director catalog for matching last name, returns earliest film by release year. Wired as fallback in `query-classifier.ts` after `findFilmFromQuery()` — only fires when no explicit film title detected. Uses `!detectedFilm` (not `!filters.film`) as gate because LLM may extract non-catalog film values that would block the fallback.
  - "Wachowskis' directorial debut" → `findDebutFilmFromQuery()` → "Bound (1996)" → `targetEpisodeTitles` → injection + 1.5x boost + 3x diversification cap → Bound chunks reliably retrieved → synthesis bridges with rule #9.
- Eval: Wachowskis/Bound now passes consistently (was flaky). Removed `flaky` tag.

### FM-15: Cross-Cutting Personal/Lifestyle Retrieval Gap — RESOLVED
- Stage: Retrieval + Synthesis
- Query type: personal preference, lifestyle, off-topic cross-episode queries (e.g., "Does Jason like BBQ", "What are the hosts' favorite foods", "Do the hosts have pets")
- Why hard now: personal/lifestyle content is mentioned incidentally during film discussions. Chunk embedding vectors are dominated by the episode's primary topic (the film), so queries about food, hobbies, or personal life have weak cosine similarity. Hosts use specific food names (e.g., "Velveeta shells and cheese") rather than generic terms (e.g., "food", "BBQ").
- Common miss: retrieval returns chunks from tangentially-related episodes; synthesis hallucinates plausible-sounding content (e.g., Italian food preferences) when retrieved evidence is thin.
- User-visible symptom: answer says "I don't have information" or invents content, despite relevant personal discussion existing elsewhere in the corpus.
- Phase 2d-3 mitigations shipped:
  1. **BM25 synonym expansion**: food/music/preference synonym clusters in `SYNONYM_MAP` feed into both BM25 search and keyword boosting. "food" → "eat", "meal", "restaurant", etc.
  2. **Speaker-aware boost**: `extractTargetSpeakers()` + `boostSpeakerMatches()` gives 1.3x boost when query names a host/guest and that person appears in chunk `metadata.speakers`.
- Results: "Does Jason like BBQ" now passes consistently (retrieves relevant personal content). "Hosts' favorite foods" retrieves 5 sources but synthesis hallucinates instead of grounding on actual content — the specific "Velveeta" chunk is still not surfaced by retrieval.
- Phase 3d attempted and reverted (synthesis anti-fabrication):
  - Three prompt-level approaches tried: (1) direct/tangential distinction in Rule #8, (2) standalone anti-fabrication Rule #13, (3) Rule #12 WEAK tier sourcing requirement. All reverted — each caused regression on Jason BBQ (model over-qualified genuine evidence) while failing to prevent hallucination on favorite foods (model invented Italian dishes from tangential chunks).
  - **Key finding**: prompt-level anti-hallucination rules cannot solve this failure mode. The model's world-knowledge priors about plausible content are stronger than grounding rules when retrieval delivers multiple tangentially-related chunks and zero direct evidence. Any rule strong enough to prevent fabrication also makes the model over-qualify genuine evidence.
  - FM-15 hallucination reclassified as primarily a **retrieval problem**, not a synthesis problem.
- **Phase 4+ partial resolution**: Personal-aside sub-chunking shipped in `scripts/ingest.ts`. `extractPersonalAsides()` scans transcripts for food-preference keyword clusters and creates small supplemental aside chunks (~200-400 tokens) with their own embedding vectors. 8 aside chunks across 5 episodes. Chunk IDs use `_1000+` offset. The specific "Velveeta shells and cheese" content now has its own chunk and is reliably retrieved for "hosts' favorite foods" queries. However, this only addressed the food-preference subcategory — clothing, hobbies, physical descriptions, and other personal topics remained hard.
- **Topic extraction resolution (shipped 2026-02-26)**: LLM topic extraction provides generic coverage for all personal/lifestyle categories without category-specific detectors. At ingest time, Haiku extracts a 2-4 sentence topic summary from each standard chunk, capturing all distinct topics including personal anecdotes, tangential digressions, brands, physical descriptions, and lifestyle mentions. Summaries are embedded at 512-dim and stored in a separate blob (`topic-vectors.json`, 54 MB, 4,799 entries). At query time, both full-text (1536-dim) and topic-summary (512-dim) vectors are searched; topic hits are resolved to parent chunks with a 0.85x score discount and merged before RRF fusion. Gated by `TOPIC_VECTORS_ENABLED` env var for instant rollback. Eval: 76/82 (0 regressions), 3 new FM-15 topic-extraction cases pass. Confirmed feature value: "physical descriptions of hosts" passes with topics ON, fails with topics OFF. Prod validation: "What instrument does Jason play?" and "What did Jason wear in high school?" both return personal content from film-dominated chunks. See `docs/topic-extraction-design.md` for full design.
- Relationship to other FMs: overlaps with FM-04 (sparse retrieval miss), FM-06 (cross-episode aggregation), and FM-11 (weak-evidence overclaim — synthesis invents rather than hedging).

### FM-16: Keyword-Anchored Retrieval Misdirection (Concept-About vs Concept-Of) — RESOLVED
- Stage: Retrieval + Synthesis
- Query type: creative/aggregation queries using a concept word (e.g., "catchphrase", "hot take", "running joke") where the user wants instances-of-the-concept across episodes, but retrieval surfaces discussions-about-the-concept from a single episode.
- Why hard now: when the query contains a distinctive keyword (e.g., "catchphrase"), BM25 and embedding retrieval both anchor on chunks where that word appears literally — typically meta-discussion segments (e.g., a "notable quotables" segment about film catchphrases) rather than the distributed cross-episode evidence of the concept in practice.
- Common miss: retrieval surfaces 1-2 chunks from a single episode that discusses the concept explicitly (movie catchphrases in Chronicles of Riddick), while the actual evidence (Jason's recurring "you hack" phrase across dozens of episodes) is never retrieved because those chunks don't contain the word "catchphrase."
- User-visible symptom: answer proposes a movie quote the host liked as their "catchphrase" rather than identifying actual recurring speech patterns.
- Example: "If Jason had a catchphrase based on the transcripts what would it be" → answer proposes "Get that ass moving" (a Vin Diesel quote from Chronicles of Riddick) instead of "you hack" (Jason's actual recurring catchphrase across many episodes).
- **Phase 5 resolution**: Three-layer fix:
  1. **Catchphrase sub-chunking** (`scripts/ingest.ts`): `extractCatchphraseChunks()` creates 3-turn sub-chunks around known recurring phrases (e.g., "you hack") with semantic prefix `[Recurring catchphrase: "you hack" — Jason Goldman]` for embedding/BM25 matching. 15 chunks across 14 episodes. Chunk IDs use `_2000+` offset.
  2. **Supplemental query expansion** (`src/lib/query-classifier.ts` + `src/lib/hybrid-retrieval.ts`): Classifier generates 1-3 supplemental search queries via Haiku for persona/aggregation queries. Run through BM25+embedding pipeline with 0.7x discount factor, merged via multi-query RRF. Deterministic supplemental query "Jason Goldman you hack" added for catchphrase + Jason patterns.
  3. **BM25 catchphrase synonyms** (`src/lib/bm25.ts`): `'catchphrase': ['phrase', 'saying', 'says', 'always']` bridges concept-word to instance-words.
- Eval: FM-16 now passes consistently — retrieves 14 sources across multiple episodes, answer identifies "you hack" as Jason's catchphrase.
- Relationship to other FMs: variant of FM-06 (cross-episode aggregation) where the keyword anchor actively misdirects retrieval away from distributed evidence. Also overlaps FM-11 (weak-evidence overclaim — treating a single movie-quote appreciation as a personal catchphrase).
- Plan alignment: Phase 2d-2 concept-vs-instance query disambiguation (resolved).

### FM-17: Character-Name Query Resolution Gap
- Stage: Classification/Retrieval
- Query type: queries referencing fictional character names (e.g., "What did Jeff Spicoli say about the American Revolution?")
- Why hard now: `findFilmFromQuery()` only matches film titles in the query, not character names. Routing to the correct episode depends entirely on the LLM classifier's world knowledge. For well-known characters (Spicoli, Damone) Haiku succeeds, but for obscure characters (Mr. Ratner, Jefferson) it may not. Even when episode routing succeeds, within-episode retrieval struggles because character discussion may be a small island in a large chunk dominated by other topics.
- Observed case: "what did Jeff Spicoli say about the American Revolution?" — Fast Times at Ridgemont High (1982).
  - **Routing**: works. Haiku correctly sets `film: "Fast Times at Ridgemont High"`, `findFilmFromQuery()` returns null (no title in query), LLM value survives. Metadata film filter matches via substring. `targetEpisodeTitles` set correctly. Episode injection, 1.5x boost, and 3x diversification cap all fire.
  - **Retrieval**: weak. The relevant content (66:05–66:37, 3 lines about Mr. Hand, Spicoli being flunked, and "American revolutionary motivation") is buried in chunk 10 (63:19–70:04, 1880 tokens) which is mostly about Phoebe Cates, the abortion subplot, and Phoebe's biographical details. BM25 indexes chunk 10 for `spicoli`(2), `american`(1), `revolutionary`(1), but competing chunks with more Spicoli mentions (chunks 5–7, 11–13) may outrank it. Embedding vector for the full chunk is semantically distant from "Spicoli American Revolution."
  - **Whisper errors**: "Spicoli" is also transcribed as "Pacoli" and "Spagoli" in the same chunk. "Spicoli" does appear correctly elsewhere (other chunks), so BM25 still matches, but within-chunk term frequency is diluted.
- Proposed mitigations:
  1. **TMDB character-name enrichment** (Phase 5): extend `enrich-tmdb.ts` to extract `character` field from TMDB credits API alongside actor `name`. Add `findCharacterFromQuery()` deterministic routing — scan query for character names, map to episode. More reliable than LLM world knowledge, especially for obscure characters.
  2. **BM25 Whisper synonym expansion**: add `pacoli`/`spagoli` → `spicoli` synonyms (like existing Eszterhas synonyms).
  3. **Supplemental query generation**: classifier could generate targeted sub-queries (e.g., "Mr. Hand Spicoli class") to improve within-episode chunk retrieval.
- Common miss: answer uses model world knowledge about the movie scene instead of surfacing the hosts' actual discussion. Or retrieves Spicoli-heavy chunks that discuss other topics.
- User-visible symptom: answer describes what happens in the movie rather than what the hosts said about it.
- Plan alignment: Phase 5 (metadata enrichment with character names), Phase 2d-2 (entity-aware retrieval).

### FM-19: Agent Synthesis Chain-of-Thought Leakage
- Stage: Synthesis (agent path)
- Query type: any query routed to agent search
- Why hard now: the agent model (Sonnet) generates its final answer as a text response after tool-use iterations. Occasionally the model includes internal planning/reasoning language (e.g., "Perfect! Now I have a comprehensive view... Let me organize this for the user.") in its output. The agent answer is passed directly to the user without post-processing.
- Common miss: answer contains meta-commentary like "Let me organize this information", "Now I have all the data", "Perfect!", or other chain-of-thought fragments that reveal the model is talking to itself rather than the user.
- User-visible symptom: answer reads as if the AI is narrating its thought process rather than presenting information directly. Breaks immersion and feels unpolished.
- Example: "What are all the times the Hoffman Process has been mentioned" → agent answer included "Perfect! Now I have a comprehensive view of all the Hoffman Process mentions. Let me organize this information for the user." before the actual organized answer.
- Non-deterministic: reproductions of the same query may not exhibit the issue (model-level stochasticity).
- Proposed mitigations:
  1. **Agent system prompt hardening**: Add explicit instruction to `AGENT_SYSTEM_PROMPT` telling the model to never include internal reasoning, planning, or meta-commentary in its answer. "Write your answer directly for the user — do not narrate your thought process."
  2. **Post-processing strip**: Regex-based cleanup of the agent answer before streaming to the user — strip lines matching patterns like "Let me organize", "Perfect!", "Now I have", "I'll present this" etc. Defense-in-depth for when the prompt instruction fails.
- Plan alignment: Phase 6 (agent search quality hardening).

## Query Classes That Are Intrinsically Hard In Current Architecture

These are expected to be hard until dedicated handling is added:
- ~~Deterministic counting/comparison tasks across explicit windows or full corpus.~~ **Mostly resolved** — Phase 6 agent search handles counting/frequency queries. Phase B expanded routing to cover windowed comparisons (B2), speaker comparisons (B1), exhaustive listings (B3), temporal ordering (B4), frequency ranking (B5), episode counting (B6), and multi-episode entity extraction (B7).
- Multi-entity, multi-clause factual prompts where evidence is split across distant chunks/episodes.
- Person-scoped attribution questions in transcripts with dense multi-speaker exchanges.
- ~~Ranking-style prompts (“most often”, “top 5 times”, “strongest preference over time”) requiring exhaustive or near-exhaustive evidence.~~ **Mostly resolved** — Phase B patterns B5 (frequency ranking) and B1 (speaker comparison) route these to agent search.
- Queries needing negative proof (“never said X”, “no episodes with Y”) without full-scan safeguards.
- ~~Queries requiring world knowledge to connect descriptions to retrieved evidence (e.g., “directorial debut” → specific film title).~~ **Partially resolved** — director-debut resolution handles “directorial debut” patterns; other implicit knowledge gaps (e.g., cultural references) remain.
- ~~Cross-cutting personal/lifestyle queries where evidence is incidental asides within film-focused chunks (e.g., food preferences, personal anecdotes, hobbies).~~ **Resolved** — LLM topic extraction (shipped 2026-02-26) provides generic coverage for all personal/lifestyle categories via Haiku-generated topic summaries embedded at 512-dim. Supplements category-specific sub-chunking (personal asides, catchphrases). See FM-15.
- Queries referencing fictional character names rather than film titles (FM-17). Routing depends on LLM world knowledge; within-episode retrieval struggles when the relevant discussion is a small section of a large chunk dominated by other topics. TMDB character-name enrichment (planned Phase 5) will add deterministic character→film routing.
- Episode identification by non-title details (FM-18). Queries that reference an episode by a personal event, sidebar film ("pod-first"), or running joke rather than the canonical film title. `findFilmFromQuery()` can't route to the correct episode because the detail isn't in the film field. Notable-moments indexing (planned Phase 5) will help.

### FM-21: Host-Scoped Topic Search Missing Specific Episodes (Agent Routing Gap)
- Stage: Routing + Retrieval
- Query type: "what does [host] say about [topic]" — cross-episode host-scoped opinion queries where the user expects exhaustive coverage across all episodes, but RAG anchors on the most literal/dominant interpretation of the topic keyword.
- Why hard now: RAG retrieval anchors on embedding similarity for the topic keyword (e.g., "the English") and surfaces chunks where that topic is most prominent (e.g., Last of the Mohicans, The King — both about British history). Chunks from episodes where the topic appears briefly in a different context (e.g., High Fidelity: "Do English people know about music the way we do?") are outranked because the embedding vector is dominated by the episode's primary subject (record collecting, music). No agent routing pattern matches "what does X say about Y" — it falls through to RAG's interpretive path.
- Common miss: answer covers 2-3 episodes with the most literal/dominant treatment of the topic keyword, but misses episodes where the host made a distinctive offhand remark about the topic in a different context.
- User-visible symptom: answer feels incomplete — user knows the host said something specific about the topic in another episode, but it's not included. Answer anchors on one narrow interpretation of the topic instead of surveying all contexts.
- Example: "What does Haitch say about the English" → RAG returns Last of the Mohicans and The King (historical English/British themes) but misses High Fidelity turn 180: "Do English people know about music the way we do?" — a distinctive comment about English culture in a music context. High Fidelity doesn't appear in results at all.
- Contributing factors:
  1. **No agent routing**: "what does X say about Y" doesn't match any existing `AGENT_ROUTING_PATTERNS`. Agent grep would find all instances of "English" in Haitch's dialogue across all transcripts.
  2. **Embedding dominance**: High Fidelity chunk containing the quote is dominated by record store / music collecting discussion — embedding similarity to "about the English" is weak.
  3. **No episode scoping**: query doesn't reference High Fidelity, so no `findFilmFromQuery()` or `targetEpisodeTitles` injection fires.
- Proposed mitigations:
  1. **New agent routing pattern B11**: Match "what does/did [host] say about [topic]" and "what has [host] said about [topic]" patterns → route to agent for exhaustive grep across all transcripts. Pattern: `/\bwhat\s+(does|did|has)\s+\w+\s+(say|said|think|thought)\s+(about|of|on)\b/i`. This is a high-volume pattern in UC-4 analytics ("what has jason said about his dad", "what has jason said about running south by south lawn", etc.).
  2. **Hybrid approach**: Run both RAG and agent in parallel for these queries, merge results. Agent provides exhaustive coverage, RAG provides synthesis context.
- Related queries from analytics that share this pattern: "what has jason said about his dad", "has jason ever talked about acting on stage", "has jason talked about his daughter and tsunamis", "what has jason said about running south by south lawn at the white house".
- **Expanded routing (shipped)**: B11 expanded to include `talk/talks/talked`. B12 added for "has X talked/spoken/commented about Y" existence queries (film-gated). B13 added for "what are some [adj] things X has said" persona aggregation. B3c added for "all the times X has [verb]" exhaustive listing with verb after "times".
- Plan alignment: Phase B+ (agent routing expansion).

### FM-20: Uningest Episode — Cross-Episode Evidence Contamination
- Stage: Retrieval (ingest gap)
- Query type: episode-scoped factual/interpretive where the target episode was never ingested
- Why hard now: new episodes may be added to metadata (via `sync-metadata.ts`) before being ingested into the vector store + BM25 index. The episode appears in the episode list and metadata, but has zero chunks. Queries scoped to that episode pull semantically similar chunks from *other* episodes (often with the same guest), and synthesis confidently attributes cross-episode evidence to the requested episode.
- Common miss: user asks "what did [guest] say about [topic] on the [film] episode" → retrieval finds guest discussing similar topic on a different episode → synthesis presents it as if it came from the target episode.
- User-visible symptom: detailed, confident answer with fabricated attribution — content is real but from the wrong episode. Particularly dangerous because the answer *sounds* correct.
- Example: "what did ben rhodes say about cuba on the argo episode" → pulls Cuba stories from Her, Casablanca, Three Days of the Condor episodes (all Ben Rhodes guest appearances) and attributes them to Argo.
- Fix: (1) re-ingest after new episode transcription, (2) retrieval should detect when zero chunks match the target episode and surface that gap instead of backfilling with cross-episode evidence, (3) synthesis should not attribute cross-episode evidence to a specific requested episode.
- Status: **Open**. Episode 299 (Argo) has 0 chunks in vector store despite having 800 dialogue turns in transcript (all speaker `?`).

## Common Miss Patterns We Should Expect

- False negatives from insufficient retrieval coverage.
- Right evidence, wrong person attribution. *(Partially mitigated: HOST_IDENTITY_RULE shipped; transcript speaker labeling errors remain.)*
- Right quote, wrong episode attribution.
- Correct intent, wrong depth mode. *(Partially mitigated: quick synthesis now gated on `requiresTranscriptDepth`.)*
- Correct metadata filter domain, wrong extracted value.
- Overconfident summary language when evidence is sparse.
- ~~Endpoint-specific inconsistencies.~~ *(Mitigated by shared routing policy module.)*
- ~~Episode-scoped query returns chunks from unrelated episodes (no hard episode filter applied).~~ *(Mitigated by Phase 2d episode-scoped injection + deterministic film filter fallback.)*
- Right sources retrieved, synthesis fails to connect implicit facts (e.g., film title ↔ director's debut).

## Detection Signals (Operational)

Track these signals to detect failure modes early:
- High disagreement rate between `/api/search` and `/api/search/stream` for same query. *(Should now be rare given shared routing policy; monitor for regression.)*
- High rate of “no information” for queries later verified as answerable.
- Elevated citation-episode mismatch rate.
- Elevated host/guest attribution correction rate in user feedback.
- Repeated boilerplate chunks in top retrieved evidence.
- Large variance in outputs for repeated runs of the same deterministic-style query.
- **Agent-specific signals** (Phase 6):
  - `agentFallbackReason` rate > 20% in 5-minute window → auto-disable triggers.
  - Agent timeout rate > 5% → investigate `AGENT_MAX_ITERATIONS` or tool performance.
  - Agent routing false positives (RAG-worthy query sent to agent) → tighten Phase A regex patterns.
  - Agent non-determinism on counting queries → accept some variance; focus on order-of-magnitude consistency.

## Test Planning Requirements By Mode

Each failure mode should have at least one eval case with:
- Positive assertion: what must appear.
- Negative assertion: what must not appear.
- Attribution assertion: person/episode accuracy where relevant.
- Endpoint parity assertion: same winner/claim across both endpoints.
- Uncertainty assertion: requires qualified wording when evidence is partial.

## Sequencing Guidance (Holistic, Not One-Off)

Apply fixes in this order:
1. Routing consistency and fallthrough guarantees (Phase 1).
2. Retrieval coverage and deterministic analyzers for counting/window classes (Phase 2).
3. Synthesis guardrails for attribution and evidence-threshold language (Phase 3).
4. Eval + CI gates that lock in behavior and prevent regressions (Phase 4).
5. Metadata canonicalization and refresh reliability (Phase 5).
6. Agent search for counting/frequency/aggregation queries that RAG can't handle (Phase 6). Expand routing patterns incrementally.

Do not ship a one-off fix unless:
- it maps to a named failure mode above,
- a reusable policy/change is identified,
- and a regression test is added for the entire class.
