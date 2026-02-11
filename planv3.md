# Plan v3: Search Quality & Reliability

## Goals
- Improve intent routing accuracy and reduce expensive misroutes.
- Raise retrieval quality with better ranking and episode‑level aggregation.
- Lower tail latency with safe parallelization.
- Make quality measurable and regressions visible.
- Ensure metadata freshness and consistency.

## Scope
- Search API flow (`/api/search` and `/api/search/stream`)
- Intent detection + classification
- Metadata retrieval + transcript retrieval
- Answer synthesis and fallbacks
- Evaluation + monitoring
- Metadata data quality and refresh process

---

## Phase 1: Routing & Latency Foundations (1–2 weeks)

### 1.1 Expand Metadata Intents (Reviewer/Guest/Release Date/Kev’s Question)
**Why:** These are deterministic metadata lookups and should bypass transcript search when confident.

**Deliverables:**
- Add explicit intent detection for reviewer/guest lookup by film or episode.
- Add explicit intent detection for episode release date by film or episode.
- Add explicit intent detection for “Kev’s Question” by film or episode.
- Normalize film titles (strip year/parentheticals) during matching.
- Return structured metadata sources for the above intents.

**Testing Criteria:**
- Add regression queries (minimum set):
- “Who reviewed No Country for Old Men?”
- “Who was the guest on No Country for Old Men?”
- “When did the No Country for Old Men episode release?”
- “What was Kev’s question for No Country for Old Men?”
- Episode‑number variants (e.g., “episode 204” for each intent).
- For each case:
- Intent == `metadata_*` (no transcript routing).
- Answer includes the requested field.
- Metadata sources include the target episode.

### 1.2 Confidence‑Based Routing Policy
**Why:** Misroutes are high‑cost and hard to detect.

**Deliverables:**
- Define intent/classification confidence thresholds (e.g., `high`, `medium`, `low`).
- Add explicit override rules:
  - If intent == metadata‑only but confidence < threshold → run metadata + transcript in parallel.
  - If filters are empty or weak → treat as hybrid unless query is clearly metadata aggregate.
- Log routing decision + confidence to enable auditing.

**Success Criteria:**
- <5% of “metadata‑answerable” queries fall back to transcript‑only.
- <5% of “interpretive” queries go metadata‑only.

### 1.3 Parallel Retrieval with Safe Short‑Circuit
**Why:** Tail latency and “slow metadata only” are unnecessary.

**Deliverables:**
- Trigger metadata and transcript retrieval in parallel.
- If metadata answer is deterministic + confidence high, return immediately but keep transcript search warm for follow‑up.
- Add configurable timeout for transcript retrieval; if timed out, return metadata with explicit notice.

**Success Criteria:**
- p95 latency reduced in mixed queries.
- Fewer “no match” outcomes when transcripts are relevant.

---

## Phase 2: Retrieval Quality (2–3 weeks)

### 2.1 Reranking + Deduping
**Why:** Hybrid retrieval returns noisy or redundant chunks.

**Deliverables:**
- Add a reranker (cross‑encoder or lightweight LLM) for top‑N chunks.
- Deduplicate near‑identical transcript chunks.
- Add episode‑level aggregation to avoid multiple chunks from same episode dominating results.

**Success Criteria:**
- Improved MRR/Recall@k on evaluation set.
- Reduced repetition in synthesis outputs.

### 2.2 Smarter Metadata Fallbacks
**Why:** Strict filters lead to empty results even when close matches exist.

**Deliverables:**
- If metadata filter returns 0 and confidence is low, relax filters (e.g., remove secondary filters; keep film/guest exact).
- Return a structured “closest matches” list with rationale.
- Ensure metadata can still contribute even for interpretive queries (episode context).

**Success Criteria:**
- Fewer “No matching episodes” for answerable queries.

---

## Phase 3: Evaluation & Monitoring (2 weeks, parallel)

### 3.1 Offline Evaluation Harness
**Why:** Changes are high‑risk without quantified impact.

**Deliverables:**
- Golden query set with expected intents + target episodes.
- Metrics: Recall@k, MRR, “answerability” rate, latency.
- CI gate for regressions beyond thresholds.

**Success Criteria:**
- Automated report on each PR or nightly build.

### 3.2 Online Feedback Loop
**Why:** Real users reveal edge cases you won’t predict.

**Deliverables:**
- Track user feedback (thumbs up/down).
- Capture routed path, filters, latency, and sources.
- Create a weekly triage report of failure modes.

**Success Criteria:**
- Clear top‑N failure reasons each week with trend lines.

---

## Phase 4: Metadata Quality & Freshness (2–3 weeks)

### 4.1 Metadata Canonicalization
**Why:** Inconsistent naming breaks filters.

**Deliverables:**
- Normalize fields: guest, reviewer, film titles (strip year, punctuation rules).
- Canonical entity lists (guests, reviewers) for exact matching + synonyms.

**Success Criteria:**
- Reduced filter misses for known entities.

### 4.2 Automated Metadata Sync
**Why:** Manual updates drift.

**Deliverables:**
- Scheduled sync from source of truth (e.g., Google Sheet).
- Validation checks (required fields, duplicates, missing film year).
- A diff report that highlights changes before release.

**Success Criteria:**
- Metadata freshness < 7 days from source updates.

---

## Risks & Mitigations
- **Over‑routing to transcripts increases cost** → gate by confidence and timeouts.
- **Reranker latency** → cap N, pre‑filter with hybrid retrieval.
- **Canonicalization false merges** → keep raw fields and emit normalized variants.

---

## Dependencies
- Access to transcript index + metadata source of truth.
- Compute budget for reranking.
- Dedicated evaluation query set and expected outcomes.

---

## Suggested Next Steps (First Week)
1. Implement confidence thresholds + routing logs.
2. Add parallel retrieval + transcript timeout handling.
3. Start collecting query routing telemetry.
