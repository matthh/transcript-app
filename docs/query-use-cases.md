# Query Use Cases

Reference document for evaluating proposed changes and bug fixes. Each change should be assessed against the use case categories it affects (positively or negatively).

Last updated: 2026-03-12

---

## Use Case Categories

### UC-1: Episode Lookup
**What**: User wants to find or identify a specific episode.
**Patterns**:
- By number: "what is episode 283", "episode 204", "tell me about episode 150"
- By non-title detail: "Which episode featured The Witch when Haitch lost his voice?" (FM-18)
- By directorial debut: "Wachowskis' directorial debut" → Bound

**Pipeline path**: Metadata fast-path (`metadata_episode_lookup`) or classifier film detection (`findFilmFromQuery`) → episode-scoped retrieval injection.
**Eval cases**: Episode lookup bare, Episode lookup by number, Episode details request, Wachowskis/Bound, The Witch/FM-18

---

### UC-2: Metadata Listing & Filtering
**What**: User wants a list of episodes matching structured criteria (director, guest, decade, year, genre, season).
**Patterns**:
- Director: "what villeneuve movies have been episodes", "which John Carpenter films"
- Guest: "which episodes had Proto as a guest"
- Year/decade: "list all movies reviewed that were made in 1980", "which 80s movies did they enjoy"
- Counts: "how many episodes are there", "how many total episodes"
- Recency: "what was the latest episode", "what season is the pod on now"
- Metadata fields: "what was the latest MMM count"

**Pipeline path**: Metadata fast-path (`metadata_director_films`, `metadata_latest`, `metadata_total_episodes`, etc.) or factual classification → `queryEpisodes`.
**Eval cases**: Episode count, Guest lookup, Director filter, 1980 year filter, Latest episode, Current season, Total episodes, Villeneuve listing, Carpenter listing, 80s movies

---

### UC-3: Single-Episode Opinion / Discussion
**What**: User wants to know what the hosts thought or said about a specific film or topic within one episode.
**Patterns**:
- "what did the hosts think about Jaws"
- "discussion about The Godfather and its legacy"
- "What did the hosts say about self-perception and relationships in the Malcolm and Marie episode?"
- "What did the hosts discuss about Decker in the Star Trek episode?"
- "What did Haitch say about the iconic one-liner from They Live?"
- "What did the hosts think about Panic Room?"
- "What is the hosts' all-time favorite movie?" (preference — requires hedged synthesis)
- "which 80s movies did they enjoy the most" (preference + decade filter)

**Note**: Preference/judgment queries (favorites, rankings) are a subtype here. Synthesis must hedge when evidence is partial — Rule #12 (preference-confidence threshold) applies.

**Pipeline path**: Classifier extracts film → `targetEpisodeTitles` → episode-scoped injection + boost + diversification cap → deep synthesis (Sonnet).
**Eval cases**: Jaws discussion, Godfather legacy, Malcolm and Marie, Star Trek/Decker, They Live one-liner, Panic Room, Legend, Boilerplate suppression (Jaws end), Preference-confidence hedging (favorite film), 80s movies enjoyment

---

### UC-4: Host-Scoped Attribution
**What**: User asks what a specific host said, thought, or did — requiring correct speaker attribution.
**Patterns**:
- "What are some of Haitch's hot takes or unpopular opinions?"
- "What is Jason's opinion of John Boorman as a director?"
**Pipeline path**: Speaker boost (1.3x) + HOST_IDENTITY_RULE in synthesis. Director fallback scopes retrieval when director detected.
**Eval cases**: Haitch hot takes, Boorman opinion

---

### UC-5: Cross-Episode Thematic Search
**What**: User asks about a topic, theme, or concept discussed across multiple episodes.
**Patterns**:
- "discussions about practical effects versus CGI"
- "when do the hosts talk about the soundtrack or musical score"
- "funniest moments on the podcast"
**Pipeline path**: Interpretive/hybrid classification → full retrieval pipeline → diversification ensures multiple episodes represented → deep synthesis.
**Eval cases**: Practical effects vs CGI, Soundtrack mentions, Broad/funniest moments, Challenger disaster

---

### UC-6: Cross-Episode Person / Entity Tracking
**What**: User wants to trace mentions of a specific person, character, or entity across the podcast.
**Patterns**:
- "every time Bill Murray is mentioned or discussed"
- "In what context has River Phoenix been mentioned?"
- "earliest mentions of director Jodorowsky"
- "hosts ranking or comparing movies by the same director"
- "List all the props the hosts have talked about buying"
- "who are the people who leave voicemails in Midsommar and the 4 episodes prior"

**Pipeline path**: Two paths depending on query structure:
- **RAG** (no agent pattern match): "every time Bill Murray is mentioned", "River Phoenix", "director ranking" — standard retrieval pipeline with diversification to surface multiple episodes.
- **Agent** (pattern match triggers): "earliest mentions of Jodorowsky" (B4: temporal ordering), "list all props talked about buying" (B3: exhaustive listing + utterance verb), "voicemailers in Midsommar and 4 episodes prior" (B7: multi-episode extraction).
**Eval cases**: Bill Murray mentions, River Phoenix, Jodorowsky cross-episode, Director ranking, Props listing, Midsommar voicemailers

---

### UC-7: Personal / Lifestyle Queries
**What**: User asks about hosts' personal preferences, habits, appearance, or off-topic asides.
**Patterns**:
- "Does Jason like BBQ?"
- "What are some of the hosts' favorite foods?"
- "What kind of shorts does Haitch like?"
- "What does Jason think of fishing?"
- "Describe what Jason and Haitch look like based on the podcast"
- "What does Rosie do for a living?"
- "Did Haitch ever have a band?"

**Pipeline path**: Topic vectors (512-dim) surface incidental personal content from film-dominated chunks. Personal-aside sub-chunks for food preferences. Speaker boost. Synthesis grounding rules #11, #12.
**Eval cases**: Jason BBQ, Hosts' favorite foods, Haitch shorts, Jason fishing (x2), Physical descriptions, Rosie's job, Haitch band history

---

### UC-8: Voicemail, Letter & Segment Queries
**What**: User asks about recurring listener segments or specific voicemail/letter content. Note: some recurring contributors are letter writers (written messages read on air), not voicemailers (audio). The system and transcripts generally refer to both as "voicemailers" but users may say "letters", "listener messages", or "voicemails" interchangeably.
**Patterns**:
- "Kev's voicemail questions to the hosts"
- "birria discussing a movie"
- "what does Truthsayer talk about in their voicemails"
- "Which Truthsayer segments have had to do with Cocaine?"
- "is there a truthsayer or birria segment with a rollerskating monkey"
- "what was kev's question in the jaws episode"
- "what was said about Twitter in the Galaxy Quest episode, original version"
- "who are the most frequent voicemailers"

**Pipeline path**: Segment sub-chunks (`_3000+` offset) with semantic prefix. BM25 synonyms (truthsayer↔birria). Agent routing for frequency/aggregation patterns. Notable-moments fallback.
**Eval cases**: Kev voicemail questions, Kev cinematography, birria discussing, Truthsayer mentions, Truthsayer cocaine, Rollerskating monkey, Kev Jaws question, Galaxy Quest Twitter, Most frequent voicemailers

---

### UC-9: Counting, Frequency & Comparison (Agent)
**What**: User wants exact counts, frequency analysis, or comparisons that require exhaustive transcript scanning.
**Patterns**:
- "how many times has Haitch interrupted a guest with 'we'll get there'"
- "who says yeah more, jason or matt"
- "Has Haitch said 'we'll get there' more in the last 100 or first 100 episodes"
- "what are some of Jason's most oft-repeated terms or phrases"

**Pipeline path**: Agent routing gate (regex pattern match) → agent-search loop (grep_transcripts, read_episode_transcript, search_episodes, list_episodes) → Sonnet synthesis. Max 10 iterations, 45s timeout.
**Eval cases**: Haitch interruptions, Who says yeah more, Windowed we'll get there, Most repeated phrases

---

### UC-10: Catchphrase & Recurring Pattern Detection
**What**: User asks about recurring phrases, verbal tics, or speech patterns.
**Patterns**:
- "If Jason had a catchphrase based on the transcripts what would it be"
- "when do the hosts say 'you hack'"

**Pipeline path**: RAG with catchphrase sub-chunks (`_2000+` offset, semantic prefix). Supplemental query expansion. Deterministic supplemental for Jason+catchphrase patterns. BM25 catchphrase synonyms.
**Eval cases**: Creative catchphrase aggregation, You hack catchphrase

---

### UC-11: Quote & Specific Phrase Lookup
**What**: User is looking for a specific quote, phrase, or word used in the podcast. Answers should include full, verbatim quotations from the transcript — not paraphrases or summaries. Users asking about quotes want to see the actual words.
**Patterns**:
- "which episode has someone saying lead paint chips were delicious"
- "in which episode is the word dingus used in a voicemail"
- "when did a caller say AKA a bunch of times"
- "what was the deal with Joe Eszterhas' security guy"
- "What did Jason say about being the digital court jew for the new pope?"

**Pipeline path**: Interpretive classification → BM25 keyword matching (with Whisper synonym expansion for ASR errors) → adjacent chunk expansion → reranking → keyword-centered excerpt extraction.
**Eval cases**: Lead paint chips, Dingus voicemail, AKA caller, Eszterhas security guy, Digital court jew, Paul Atreides Nutz, Dune sleeves quote, The Mark/American Movie, Deakins Award

---

### UC-12: Factual Fallback (World-Knowledge Bridging)
**What**: User asks a factual question about a film (e.g., who directed it) in the context of what the hosts said. Requires connecting world knowledge to transcript content.
**Patterns**:
- "who directed Rushmore according to the hosts"
- "What did the hosts think about how the Wachowskis' directorial debut compared to other first-time filmmakers?"

**Pipeline path**: Synthesis Rule #9 (implicit knowledge bridging). `findDebutFilmFromQuery()` for debut patterns. Film detection → episode scoping → synthesis connects.
**Eval cases**: Rushmore director, Wachowskis/Bound

---

### UC-13: Guest-Scoped Queries
**What**: User asks about a specific guest's appearance or what they discussed.
**Patterns**:
- "Rosie Knight talking about comics or superheroes"
- "What does Rosie do for a living?"
- "Villeneuve Marin interview retrieval"

**Pipeline path**: Guest filter in metadata or interpretive classification → transcript retrieval scoped by guest name.
**Eval cases**: Rosie Knight guest discussion, Rosie's job, Villeneuve Marin interview

---

### UC-14: Podcast Meta Queries
**What**: User asks about podcast-level concepts: Tilda casting, recommendations, full catalog.
**Patterns**:
- "who would Tilda play in the next movie"
- "Review every movie the podcast has covered, then suggest 10 more films they should cover"

**Pipeline path**: Tilda → metadata `tildaH`/`tildaJason`/`tildaGuest` fields. Full catalog → known limitation (too broad for RAG).
**Eval cases**: Tilda casting, Full catalog suggestion (known limitation)

---

## Cross-Cutting Concerns

These apply across multiple use cases:

| Concern | Affected UCs | Mechanism |
|---------|-------------|-----------|
| **Whisper ASR errors** | UC-6, UC-12 | BM25 synonym expansion bridges transcription errors |
| **Episode title normalization** | UC-1, UC-3, UC-8 | `normalizeEpisodeTitle()` strips year suffixes |
| **Speaker attribution accuracy** | UC-4, UC-7, UC-8 | HOST_IDENTITY_RULE + speaker boost + transcript label quality |
| **Boilerplate suppression** | UC-3, UC-5, UC-12 | `suppressBoilerplate()` downranks outro/credits |
| **Best-of / rebroadcast dedup** | UC-3, UC-5 | Jaccard dedup + diversification |
| **Synthesis grounding** | All interpretive | 12 grounding rules in `buildSystemPrompt()` |
| **Topic vectors** | UC-5, UC-7, UC-17 | 512-dim supplemental vectors for incidental content |

---

## How to Use This Document

When evaluating a proposed change or bug fix:

1. **Identify affected use cases**: Which UCs does the change target? Which might it affect as a side effect?
2. **Check eval coverage**: Are there eval cases for the affected UCs? Will the change cause regressions?
3. **Assess tradeoffs across UCs**: A change that improves UC-9 (counting) should not regress UC-3 (single-episode opinion). Document expected impact per UC.
4. **Prioritize by UC importance**: See stack rank below.

---

## Stack Rank (for review)

> Rank these categories by importance to guide where investment should go and which regressions are least acceptable.

| Tier | Rank | Use Case | Rationale |
|------|------|----------|-----------|
| **Must nail** | 1 | **UC-3: Single-Episode Opinion** | Core use case — "what did they think about X?" is the most common query pattern. Includes preference/judgment queries. |
| | 2 | **UC-11: Quote & Phrase Lookup** | High-value "find that moment" queries — this is what makes the product feel magical |
| | 3 | **UC-4: Host-Scoped Attribution** | Differentiator — users care who said what |
| | 4 | **UC-5: Cross-Episode Thematic** | Key for discovery — surfacing patterns across the podcast |
| **Important** | 5 | **UC-8: Voicemail, Letter & Segment** | Important to the podcast's community identity |
| | 6 | **UC-7: Personal / Lifestyle** | Fans love these — "does Jason like BBQ" type queries |
| | 7 | **UC-6: Cross-Episode Entity / Exhaustive Tracking** | Valuable but tolerates partial answers |
| | 8 | **UC-10: Catchphrase & Recurring Patterns** | Fun, community-driven |
| **Nice to have** | 9 | **UC-1: Episode Lookup** | Useful but users can browse the episode list |
| | 10 | **UC-2: Metadata Listing** | Useful but not why users come to the search tool |
| | 11 | **UC-9: Counting & Frequency (Agent)** | Impressive when it works, but niche |
| | 12 | **UC-13: Guest-Scoped** | Moderate frequency |
| | 13 | **UC-12: Factual Fallback** | Edge case, mostly handled |
| | 14 | **UC-14: Podcast Meta** | Rare, partially out of scope |
