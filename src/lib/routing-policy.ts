import { EpisodeMetadata, MetadataSource, ClassificationResult, SearchStrategy } from '@/types/episode-metadata';
import { QueryIntent } from './query-intent';

/**
 * Synthesis Policy Matrix
 *
 * Maps query class to model, token budget, chunk usage, and prompt style.
 * Cross-references `buildSystemPrompt()` in `src/lib/claude.ts`.
 *
 * | Query class                        | Model  | Max tokens | Chunks | Prompt style                       |
 * |------------------------------------|--------|------------|--------|------------------------------------|
 * | factual + metadata-only + quick    | Haiku  | 700        | 4      | Lists/counts                       |
 * | factual + metadata + transcripts   | Sonnet | 2048-3072  | All    | Facts, metadata primary            |
 * | factual + transcript-only fallback | Sonnet | 2048-3072  | All    | Facts from transcript discussion   |
 * | interpretive                       | Sonnet | 1024-2048  | All    | Opinions/quotes/nuance             |
 * | hybrid                             | Sonnet | 1536-2560  | All    | Metadata filter + analysis         |
 *
 * Grounding rules (all in buildSystemPrompt basePrompt):
 *  #1  Base answers on provided data (allow world-knowledge bridging)
 *  #2  Never invent episodes/films/guests/quotes
 *  #3  State "I don't have information" when data is absent
 *  #4  Never make up plausible-sounding answers
 *  #5  Only list episodes from EPISODE METADATA section
 *  #6  Extract factual info from transcript conversation
 *  #7  Search ALL excerpts before concluding "no information"
 *  #8  PARTIAL EVIDENCE — report findings when any relevant content exists
 *  #9  IMPLICIT KNOWLEDGE BRIDGING — connect descriptions to sources via world knowledge
 *  #10 MULTI-REFERENT COVERAGE — address all distinct referent clusters
 *  #11 HOST-SCOPED EVIDENCE PRIORITY — attribute host vs guest speech correctly
 *  #12 PREFERENCE-CONFIDENCE THRESHOLD — calibrate confidence to evidence strength
 *  +   HOST_IDENTITY_RULE — Haitch & Jason are the only hosts
 */

// Pagination constants
export const MAX_LIMIT = 500;
export const DEFAULT_LIMIT = 100;

// Synthesis tuning constants
export const QUICK_SYNTHESIS = {
  maxChunks: 4,
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 700,
} as const;

export const DEEP_SYNTHESIS_MODEL = 'claude-sonnet-4-20250514';

// Shared helper: convert episode metadata to source shape for API responses
export function episodeToMetadataSource(episode: EpisodeMetadata): MetadataSource {
  const relevantFields: Record<string, string> = {};

  if (episode.notableMoments) {
    relevantFields['Notable Moments'] = episode.notableMoments;
  }
  if (episode.hFlex) {
    relevantFields['H Flex'] = episode.hFlex;
  }
  if (episode.jFlex) {
    relevantFields['J Flex'] = episode.jFlex;
  }
  if (episode.kevsQuestion) {
    relevantFields["Kev's Question"] = episode.kevsQuestion;
  }
  if (episode.tildaH) {
    relevantFields['Tilda H'] = episode.tildaH;
  }
  if (episode.tildaJason) {
    relevantFields['Tilda Jason'] = episode.tildaJason;
  }
  if (episode.tildaGuest) {
    relevantFields['Tilda Guest'] = episode.tildaGuest;
  }
  if (episode.tildaCorey) {
    relevantFields['Tilda Corey'] = episode.tildaCorey;
  }

  return {
    film: episode.film,
    season: episode.season,
    episode: episode.episode,
    releaseDate: episode.releaseDate,
    guest: episode.guest,
    reviewer: episode.reviewer,
    relevantFields,
  };
}

// Routing policy: skip metadata aggregate for medium-confidence intents
export function shouldSkipMetadataAggregate(intent: QueryIntent): boolean {
  return intent.confidence === 'medium';
}

// Routing policy: force hybrid classification when confidence is low and no filters
export function shouldForceHybridClassification(classification: ClassificationResult): boolean {
  return classification.confidence < 0.6 && Object.keys(classification.filters).length === 0;
}

// Routing policy: use quick synthesis only for factual queries that don't need transcript depth
export function shouldUseQuickSynthesis(
  depth: 'quick' | 'deep',
  classification: ClassificationResult,
): boolean {
  return depth === 'quick'
    && classification.type === 'factual'
    && !classification.requiresTranscriptDepth;
}

// ─── Agent Search Constants ────────────────────────────────────────────────

export const AGENT_SEARCH_MODEL = 'claude-sonnet-4-20250514';
export const AGENT_MAX_ITERATIONS = 10;
export const AGENT_TIMEOUT_MS = 45_000;
export const AGENT_MAX_TOOL_ERRORS = 3;
export const AGENT_WEAK_EVIDENCE_THRESHOLD = 2; // sources below this = weak evidence

// ─── Agent Feature Flags ───────────────────────────────────────────────────

export interface AgentFeatureFlags {
  enabled: boolean;
  percentRollout: number;
  forceForTags: string[];
  disableOnErrorRate: number;
}

export function getAgentFeatureFlags(): AgentFeatureFlags {
  return {
    enabled: process.env.AGENT_SEARCH_ENABLED === 'true',
    percentRollout: Math.min(100, Math.max(0,
      parseInt(process.env.AGENT_SEARCH_PERCENT_ROLLOUT ?? '100', 10) || 100
    )),
    forceForTags: process.env.AGENT_SEARCH_FORCE_FOR_TAGS
      ? JSON.parse(process.env.AGENT_SEARCH_FORCE_FOR_TAGS) as string[]
      : [],
    disableOnErrorRate: parseFloat(process.env.AGENT_SEARCH_DISABLE_ON_ERROR_RATE ?? '0.2') || 0.2,
  };
}

// In-memory error rate tracking for auto-disable
let agentErrorWindow: number[] = [];
let agentRequestWindow: number[] = [];
let agentAutoDisabled = false;
const ERROR_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function recordAgentResult(success: boolean): void {
  const now = Date.now();
  agentRequestWindow.push(now);
  if (!success) agentErrorWindow.push(now);

  // Prune old entries
  agentErrorWindow = agentErrorWindow.filter(t => now - t < ERROR_WINDOW_MS);
  agentRequestWindow = agentRequestWindow.filter(t => now - t < ERROR_WINDOW_MS);

  const flags = getAgentFeatureFlags();
  if (agentRequestWindow.length >= 5) { // need minimum sample
    const errorRate = agentErrorWindow.length / agentRequestWindow.length;
    if (errorRate > flags.disableOnErrorRate) {
      console.warn(`Agent auto-disabled: error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(flags.disableOnErrorRate * 100).toFixed(0)}%`);
      agentAutoDisabled = true;
    }
  }
}

export function isAgentAutoDisabled(): boolean {
  return agentAutoDisabled;
}

// ─── Agent Routing Decision (Two-Step Gate) ────────────────────────────────

/**
 * Agent routing patterns — deterministic regex gate for agent search.
 *
 * Phase A (day-1): counting/frequency queries with verb anchor.
 * Phase B: broader aggregation patterns from user feedback analysis (Feb 2026).
 *   B1: Speaker comparison — "who says X more"
 *   B2: Windowed comparison — "first/last N episodes" with comparison word
 *   B3: Exhaustive listing — "list/name all/every" + utterance verb
 *   B4: Earliest/first mention — temporal ordering
 *   B5: Most frequent/common/repeated + noun signal
 *   B6: Episode counting with topic verb — "how many episodes mention/discuss X"
 *   B7: Multi-episode entity extraction — "in [episode] and N episodes prior/before/after"
 *
 * Catchphrase/recurring-phrase patterns remain deferred — RAG handles via sub-chunks.
 * Metadata-only listing queries (e.g., "list all movies reviewed") stay on RAG (no utterance verb).
 */
const AGENT_ROUTING_PATTERNS: RegExp[] = [
  // Phase A: counting/frequency with verb anchor
  /\b(how many times|how often|every time)\b.*\b(say|said|says|mention|mentioned|use|used|ask|asked|interrupt|interrupted|tell|told|bring up|brought up|call|called|repeat|repeated|reference|referenced)\b/i,

  // Phase B1: Speaker comparison — "who says X more"
  /\bwho\s+(say|says|said)\b.*\bmore\b/i,

  // Phase B2: Windowed comparison — "first/last N episodes" with comparison word
  /\b(first|last)\s+\d+\s*(episode|ep)s?\b.*\b(more|less|most|often|first|last)\b/i,

  // Phase B3: Exhaustive listing — "list/name all/every" + utterance verb
  /\b(list|name)\s+(all|every)\b.*\b(talked|discussed|mentioned|said|brought up)\b/i,

  // Phase B4: Earliest/first mention — temporal ordering
  /\b(earliest|first)\s+(mention|time|instance|reference|discussion)s?\s+(of|that)\b/i,

  // Phase B5: Most frequent/common/repeated + noun signal (plural-safe)
  /\bmost\s+(frequent|common|oft|often|repeated|recurring)\b.*\b(phrases?|words?|terms?|expressions?|things?|catchphrases?|voicemailers?|callers?)\b/i,

  // Phase B6: Episode counting with topic verb — "how many episodes mention/discuss X"
  /\bhow many\b.*\bepisodes?\b.*\b(mention|discuss|talk|cover|reference|feature|bring up)\b/i,

  // Phase B7: Multi-episode entity extraction — "in [episode] and N episodes prior/before/after"
  /\b\d+\s*(episode|ep)s?\s*(prior|before|after|earlier|later)\b/i,
];

/**
 * Two-step routing gate:
 * Step 1: Classifier suggests searchStrategy='agent'
 * Step 2: Deterministic policy approves (pattern match + feature flags)
 *
 * Returns 'agent' only when ALL conditions are met:
 * - AGENT_SEARCH_ENABLED=true and not auto-disabled
 * - Query matches at least one AGENT_ROUTING_PATTERNS regex (Phase A + B)
 * - Rollout percentage check passes
 *
 * Phase A patterns: counting/frequency with verb anchor.
 * Phase B patterns: speaker comparison, windowed comparison, exhaustive listing,
 *   temporal ordering, frequency ranking, episode counting, multi-episode extraction.
 *
 * Queries that stay on RAG (no pattern match):
 * - Personal queries ("Does Jason like BBQ?") — RAG sub-chunks
 * - Catchphrase queries ("If Jason had a catchphrase") — RAG sub-chunks
 * - Metadata-only listings ("list all movies reviewed") — no utterance verb
 * - Single-episode opinion queries — standard retrieval
 *
 * Otherwise returns 'rag'.
 */
export function resolveSearchStrategy(
  query: string,
  classifierSuggestion?: SearchStrategy,
): SearchStrategy {
  const flags = getAgentFeatureFlags();

  // Gate 1: Master switch
  if (!flags.enabled || agentAutoDisabled) return 'rag';

  // Gate 2: Query must match at least one deterministic pattern
  const matchesPattern = AGENT_ROUTING_PATTERNS.some(p => p.test(query));
  if (!matchesPattern) return 'rag';

  // Gate 3: Classifier must have suggested agent, OR pattern is a force-override
  // (Phase A patterns are force-overrides — they're narrow enough to be trusted)
  // So if the pattern matched, we proceed even without classifier agreement.

  // Gate 4: Rollout percentage
  if (flags.percentRollout < 100) {
    const roll = Math.random() * 100;
    if (roll >= flags.percentRollout) return 'rag';
  }

  return 'agent';
}
