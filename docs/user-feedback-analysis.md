# User Feedback Analysis — February 2026

Consolidated from two sources:
- **Web app** (Vercel Blob `feedback-log/`): 10 entries (3 good, 7 bad)
- **Discord bot** (Google Sheet via Railway): 6 entries (all bad — bot only logs thumbs-down)

Total: **16 entries** (3 good, 13 bad)

---

## Passing Queries (3)

| # | Source | User | Query | Notes |
|---|--------|------|-------|-------|
| G1 | Web | Jason | "what are the opinions on cameron crowe" | Cross-episode opinion aggregation worked |
| G2 | Web | Jason | "how much do hosts love Andor?" | Persona/opinion query worked well |
| G3 | Web | Space Monkey | "Why do the hosts do what they do" | Interpretive/persona query, good synthesis |

**Takeaway**: Opinion/persona queries about well-discussed topics succeed — retrieval finds enough evidence, synthesis grounds well.

---

## Failing Queries (13)

### Mapped to Failure Modes

| # | Source | User | Query | User Comment | FM | Root Cause |
|---|--------|------|-------|-------------|-----|------------|
| F1 | Web | Haitch | "List all the props Ryan and Dave have talked about buying on the pod" | Missing all of Ryan's Terminator and Aliens props | **FM-06** | Cross-episode aggregation. Props discussion scattered across many episodes; top-K retrieval can't exhaustively collect. |
| F2 | Web | Jason | "What do we know about Corey's attraction to whips" | Should have found some Corey quote | **FM-04, FM-07** | Sparse retrieval miss + person-scoped query. "Corey" is a voicemailer — speaker attribution in chunks may not index well. |
| F3 | Web | Jason | "Has predator badlands been discussed" | "I don't think Meredith was on the Rushmore ep" | **FM-08** | Episode attribution error. Synthesis blended details from separate episodes, attributing a person to the wrong episode. |
| F4 | Web | Jason | "What is Jason's opinion of John Boorman" | Should have pulled comments from Point Blank | **FM-03, FM-04** | Filter extraction + sparse retrieval. "John Boorman" should route to Point Blank episode but classifier may not have connected director→film. Within-episode retrieval missed relevant chunks. |
| F5 | Web | Jason | "Has Haitch said 'we'll get there' more in the last 100 episodes or more in the first 100 episodes" | Should have found mentions in most recent eps | **FM-05** | Windowed frequency comparison. Counting task across explicit windows — exactly the hard case FM-05 describes. Partially addressed by Phase 6 agent search but this query pattern may not match the Phase A regex gate. |
| F6 | Web | Jason | "What does Jason think of fishing" | Only hit one ep | **FM-15, FM-06** | Cross-cutting personal/lifestyle retrieval gap. "Fishing" is an incidental personal topic buried in film-focused chunks. Only 1 episode surfaced; others missed. |
| F7 | Web | Space Monkey | "what are some of Jason's most oft-repeated terms or phrases such as 'Listen,' or 'That's Great,' but not including these specific examples" | Specified not to include examples it provided | **FM-06, NEW** | Cross-episode aggregation + **synthesis instruction-following failure**. Returned "That's Great" count despite explicit exclusion. Synthesis ignored a negative constraint in the query. |
| F8 | Discord | goldtoe | "how many episodes of the podcast are there" | (thumbs down) | **FM-06** | Metadata counting. Answer said 304 — may be wrong count or user expected different number. Could be a metadata staleness issue. |
| F9 | Discord | goldtoe | "what villeneuve movies have been episodes?" | (thumbs down) | **FM-06** | Cross-episode list aggregation. Answer listed 4 films / 5 episodes — may be incomplete. Requires exhaustive metadata scan. |
| F10 | Discord | chaotic_good_23 | "list one movie from each year 1980-1990 that the pod has covered and give year with each" | (thumbs down) | **FM-06** | Cross-episode aggregation + metadata. Answer gave wrong years (e.g., "Starman (1980)" — Starman is 1984). Synthesis hallucinated year associations. |
| F11 | Discord | goldtoe | "what are the earliest mentions of the director Jodorowsky on the pod" | (thumbs down) | **FM-06, FM-04** | Temporal cross-episode aggregation. Requires identifying first occurrence across corpus — hard without exhaustive scan. |
| F12 | Discord | goldtoe | "what have hosts said about the Challenger disaster?" | (thumbs down) | **FM-04, FM-06** | Sparse retrieval + cross-episode aggregation. Incidental topic (not a film title), evidence scattered. |
| F13 | Discord | nosko. | "who are the people who leave voicemails in the Midsommar episode, and the 4 episodes prior to it" | (thumbs down) | **FM-06, FM-07** | Multi-episode entity extraction. Requires identifying voicemailers across 5 specific episodes — needs exhaustive within-episode scan, not top-K. Answer returned "no information." |

---

## Failure Mode Frequency

| FM | Description | Count | Status in Docs |
|----|-------------|-------|---------------|
| **FM-06** | Cross-Episode Aggregation | **11** | PARTIALLY MITIGATED — agent search handles counting/frequency with verb anchors only |
| **FM-04** | Sparse Retrieval Miss | **5** | MOSTLY MITIGATED — but incidental/personal topics still miss |
| **FM-07** | Role Attribution Error | **3** | PARTIALLY MITIGATED — HOST_IDENTITY_RULE helps hosts, but guest/voicemailer scoping weak |
| **FM-08** | Episode Attribution Error | **2** | UNMITIGATED — no dedicated fix shipped |
| **FM-05** | Windowed Frequency Comparison | **1** | PARTIALLY MITIGATED — Phase 6 agent, but narrow regex gate |
| **FM-03** | Filter Extraction Failure | **1** | PARTIALLY MITIGATED — director→film routing gap |
| **FM-15** | Cross-Cutting Personal/Lifestyle | **1** | RESOLVED for food; fishing/other topics still miss |
| **NEW** | Synthesis Instruction-Following | **1** | NOT TRACKED — synthesis ignores negative constraints |

*(Counts exceed 13 because some queries map to multiple FMs.)*

---

## Key Findings

### 1. FM-06 (Cross-Episode Aggregation) is the dominant failure — 11 of 13 bad queries

This is by far the biggest gap. The common thread: users ask for **exhaustive lists, counts, or temporal patterns** across the corpus, and top-K retrieval fundamentally cannot deliver exhaustive results.

Sub-patterns within FM-06:
- **Exhaustive listing**: "list all props", "what villeneuve movies", "one movie from each year" (F1, F9, F10)
- **Temporal/ordering**: "earliest mentions of Jodorowsky", "most recent eps" (F5, F11)
- **Multi-episode entity extraction**: "voicemailers in 5 episodes", "repeated phrases" (F7, F13)
- **Counting**: "how many episodes" (F8)

**planv4 alignment**: Phase 6 agent search was designed for this, but the Phase A regex gate is very narrow — only matches `(how many times|how often|every time).*\b(say|said|mention)\b`. Most of the real user queries above would NOT match this gate:
- "List all the props" — no verb anchor
- "what villeneuve movies have been episodes" — no counting verb
- "earliest mentions of Jodorowsky" — no "how many/how often"
- "who are the people who leave voicemails" — entity extraction, not counting

**Recommendation**: Phase B agent routing expansion is the critical next step. The agent infrastructure exists; the routing gate needs broadening to cover listing, temporal, entity-extraction, and exhaustive-scan patterns beyond just counting with verb anchors.

### 2. Metadata queries need a dedicated path

F8 ("how many episodes"), F9 ("what villeneuve movies"), F10 ("one movie from each year 1980-1990") are all answerable from metadata alone — no transcript search needed. The metadata fast-path exists but apparently doesn't handle these list/count patterns well.

**planv4 alignment**: Phase 1 shipped metadata fast-path for episode lookups, but exhaustive metadata aggregation (list all X, count, filter by year range) isn't covered.

### 3. Director→film routing gap (F4)

"What is Jason's opinion of John Boorman" — user expects Point Blank content. `findFilmFromQuery()` only matches film titles, not director names used as primary query subject. The classifier may or may not connect "Boorman" → Point Blank.

**planv4 alignment**: Phase 5 covers TMDB enrichment for character names (FM-17), but director-name→film routing isn't explicitly listed. `findDebutFilmFromQuery()` only handles "debut" patterns, not general "director name" → "all their films" mapping.

**Recommendation**: Extend deterministic routing to handle director-name queries → all episodes covering that director's films.

### 4. New failure: Synthesis instruction-following (F7)

Query explicitly said "not including these specific examples" but synthesis returned exactly those examples. This is distinct from any existing FM — it's a synthesis compliance issue, not retrieval or routing.

**planv4 alignment**: Not covered. Could be addressed with a new synthesis grounding rule about honoring explicit negative constraints in the query.

### 5. FM-15 isn't fully resolved for non-food personal topics (F6)

"What does Jason think of fishing" — personal-aside sub-chunking was built for food preferences. Fishing, hobbies, and other incidental personal topics remain hard. The sub-chunking approach works but needs category expansion.

**planv4 alignment**: FM-15 marked RESOLVED but the resolution was food-specific. Other personal topic categories need the same treatment.

---

## Recommended Priority Actions

1. **Expand agent routing gate (Phase B)** — broaden beyond counting+verb to cover:
   - Exhaustive listing patterns: "list all", "what [X] have", "every [X]"
   - Temporal patterns: "earliest", "first time", "most recent"
   - Multi-episode entity extraction: "who [verb] in [episode] and [N] episodes"
   - This alone would address F1, F5, F7, F9, F10, F11, F13 (7 of 13 failures)

2. **Metadata aggregation path** — for queries answerable purely from episode metadata:
   - "how many episodes" → count metadata entries
   - "what [director] movies have been episodes" → filter metadata by director
   - "one movie from each year X-Y" → filter + group metadata by year
   - Addresses F8, F9, F10

3. **Director-name routing** — extend `findFilmFromQuery()` or add `findFilmsByDirectorFromQuery()` to map director names to their episodes in the catalog. Addresses F4.

4. **Synthesis negative-constraint rule** — add grounding rule requiring synthesis to honor explicit exclusions in the query ("not including X"). Addresses F7.

5. **Expand personal-aside sub-chunking** — add categories beyond food (hobbies, personal stories, non-film interests). Addresses F6.

---

## Phase B Resolution (Feb 2026)

Agent routing gate expanded from 1 narrow regex (Phase A) to 8 patterns (Phase A + B1–B7). The agent search infrastructure was already live; only routing patterns were broadened.

### Addressed Failures

| # | Query | Pattern | Notes |
|---|-------|---------|-------|
| F1 | "List all the props...talked about buying" | B3 (exhaustive listing) | `list all` + `talked` matches |
| F5 | "Has Haitch said 'we'll get there' more in the last 100 episodes..." | B2 (windowed comparison) | `last 100 episodes` + `more` matches |
| F7 | "most oft-repeated terms or phrases" | B5 (frequency ranking) | `most oft` + `phrases` matches |
| F11 | "earliest mentions of Jodorowsky" | B4 (temporal ordering) | `earliest mentions of` matches |
| F13 | "voicemails in the Midsommar episode and 4 episodes prior" | B7 (multi-episode extraction) | `4 episodes prior` matches |

### Unaddressed Failures (remain on RAG or require other fixes)

| # | Query | Why Not Addressed |
|---|-------|-------------------|
| F2 | "Corey's attraction to whips" | Sparse retrieval + speaker attribution — needs better voicemailer indexing |
| F3 | "Has predator badlands been discussed" | Episode attribution error (FM-08) — synthesis problem, not routing |
| F4 | "Jason's opinion of John Boorman" | Director→film routing gap — needs `findFilmsByDirectorFromQuery()` |
| F6 | "What does Jason think of fishing" | Cross-cutting personal topic — needs personal-aside sub-chunk expansion |
| F8 | "how many episodes are there" | Metadata counting — needs dedicated metadata aggregation path |
| F9 | "what villeneuve movies have been episodes" | Metadata listing — no utterance verb, stays on RAG |
| F10 | "one movie from each year 1980-1990" | Metadata aggregation + year hallucination — needs metadata path |
| F12 | "what have hosts said about the Challenger disaster" | Sparse retrieval for incidental topics — needs broader sub-chunking |

---

## Data Sources

- Web feedback: `feedback-log/2026-02/*.json` in Vercel Blob (10 entries, Feb 8-24)
- Discord feedback: Google Sheet `1hv51P7G38WKSrq11qTLLEO6Tsf-Nggmi3yRHmcY9sdA`, tab "Feedback" (6 entries, Feb 8-10)
- Failure mode reference: `docs/query-failure-modes.md`
- Plan reference: `planv4.md`
