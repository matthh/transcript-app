import { EpisodeMetadata, MetadataSource, ClassificationResult } from '@/types/episode-metadata';
import { QueryIntent } from './query-intent';

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
