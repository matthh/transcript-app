import { EpisodeMetadata, MetadataSource, ClassificationResult } from '@/types/episode-metadata';
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
 *  #13 ANTI-FABRICATION — only cite specifics that appear as text in provided excerpts
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
