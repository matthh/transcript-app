import Anthropic from '@anthropic-ai/sdk';
import {
  QueryType,
  QueryFilters,
  ClassificationResult,
} from '@/types/episode-metadata';

// Fallback heuristics - only used if LLM fails
const FACTUAL_TRIGGERS = [
  'how many', 'count', 'list', 'which episodes', 'which movies', 'which films',
  'what movies', 'what films', 'total', 'longest', 'shortest', 'when did',
  'what episode', 'who was the guest', 'who reviewed', 'what film', 'what movie',
  'all episodes', 'every episode', 'number of',
];

const INTERPRETIVE_TRIGGERS = [
  'what did they think', 'opinion', 'feel about', 'favorite', 'favourite',
  'what did', 'how did', 'why did', 'thoughts on', 'reaction to', 'perspective',
  'analysis', 'discussion', 'talked about', 'said about', 'mentioned',
  ' said ', ' say ', 'wants to', 'want to', 'thinks about', 'think about',
];

const DECADE_PATTERNS = [
  { pattern: /\b(19[0-9]0)s\b/i, extract: (m: RegExpMatchArray) => parseInt(m[1]) },
  { pattern: /\b(20[0-9]0)s\b/i, extract: (m: RegExpMatchArray) => parseInt(m[1]) },
  { pattern: /\b([2-9]0)s\b/i, extract: (m: RegExpMatchArray) => 1900 + parseInt(m[1]) },
  { pattern: /\b(00)s\b/i, extract: () => 2000 },
  { pattern: /\b(10)s\b/i, extract: () => 2010 },
  { pattern: /\beighties\b/i, extract: () => 1980 },
  { pattern: /\bnineties\b/i, extract: () => 1990 },
  { pattern: /\bseventies\b/i, extract: () => 1970 },
  { pattern: /\bsixties\b/i, extract: () => 1960 },
  { pattern: /\bfifties\b/i, extract: () => 1950 },
];

const SEASON_PATTERN = /\bseason\s*(\d+)\b/i;

/**
 * Classification logging for offline tuning.
 * In production, this could write to a database or analytics service.
 */
function logClassification(query: string, result: ClassificationResult, source: 'llm' | 'fallback', latencyMs: number) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    query,
    type: result.type,
    confidence: result.confidence,
    filters: result.filters,
    source,
    latencyMs,
  };
  console.log('CLASSIFICATION_LOG:', JSON.stringify(logEntry));
}

/**
 * Main classification function - always uses LLM for accurate classification.
 * Falls back to heuristics only if LLM call fails.
 */
export async function classifyQuery(query: string): Promise<ClassificationResult> {
  const startTime = Date.now();

  try {
    const result = await classifyWithLLM(query);
    logClassification(query, result, 'llm', Date.now() - startTime);
    return result;
  } catch (error) {
    console.warn('LLM classification failed, using fallback heuristics:', error);
    const result = classifyQuerySync(query);
    logClassification(query, result, 'fallback', Date.now() - startTime);
    return result;
  }
}

/**
 * LLM-based classification - classifies query type AND extracts filters in one call.
 */
async function classifyWithLLM(query: string): Promise<ClassificationResult> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const message = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Classify this podcast search query and extract filters.

Query: "${query}"

This is a movie podcast search. Classify the INTENT:

**factual** - User wants specific data: counts, lists, episode numbers, guest appearances, dates
  Examples: "How many episodes?", "List all X episodes", "Who was the guest on Y?", "Proto episodes"

**interpretive** - User wants opinions, analysis, or what hosts said/thought
  Examples: "What did they think about X?", "Their reaction to Y", "Discussion of Z"

**hybrid** - User wants both metadata AND interpretive content
  Examples: "Which 80s movies did they enjoy?", "Best episodes about sci-fi"

Extract filters if present (leave out if not mentioned):
- guest: Person who appeared as a guest (e.g., "Proto", "Tommy Vietor")
- film: Film/movie title (e.g., "Dune", "The Goonies", "close encounters")
- reviewer: Specific host name if mentioned
- decade: Base year for decade references (1980 for "80s")
- season: Season number
- director: Film director name (e.g., "Tim Burton", "Denis Villeneuve", "Spielberg")
- cinematographer: Director of Photography (e.g., "Roger Deakins", "Janusz Kamiński")
- actor: Actor/actress name (e.g., "Tom Hanks", "Sigourney Weaver")
- genre: Film genre (e.g., "horror", "sci-fi", "comedy", "action")

IMPORTANT:
- Short queries like "Proto episodes" or "Dune" are typically factual (looking for episode list)
- Questions about "what they said/thought/felt" are interpretive
- Queries about directors, actors, or cinematographers are typically factual (e.g., "Tim Burton movies" → director filter)
- Don't extract question words (who, what, which) as entity values

Respond with ONLY valid JSON:
{"type": "factual|interpretive|hybrid", "confidence": 0.7-0.95, "filters": {"guest?": "string", "film?": "string", "director?": "string", "actor?": "string", "genre?": "string"}}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from LLM');
  }

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM response: ' + textBlock.text);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate and normalize the response
  const validTypes: QueryType[] = ['factual', 'interpretive', 'hybrid'];
  const type: QueryType = validTypes.includes(parsed.type) ? parsed.type : 'interpretive';
  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0.5, Math.min(0.95, parsed.confidence))
    : 0.7;

  // Extract and clean filters
  const filters: QueryFilters = {};
  if (parsed.filters) {
    if (parsed.filters.guest && typeof parsed.filters.guest === 'string') {
      filters.guest = parsed.filters.guest;
    }
    if (parsed.filters.film && typeof parsed.filters.film === 'string') {
      filters.film = parsed.filters.film;
    }
    if (parsed.filters.reviewer && typeof parsed.filters.reviewer === 'string') {
      filters.reviewer = parsed.filters.reviewer;
    }
    if (parsed.filters.decade && typeof parsed.filters.decade === 'number') {
      filters.decade = parsed.filters.decade;
    }
    if (parsed.filters.season && typeof parsed.filters.season === 'number') {
      filters.season = parsed.filters.season;
    }
    // TMDB-enriched filters
    if (parsed.filters.director && typeof parsed.filters.director === 'string') {
      filters.director = parsed.filters.director;
    }
    if (parsed.filters.cinematographer && typeof parsed.filters.cinematographer === 'string') {
      filters.cinematographer = parsed.filters.cinematographer;
    }
    if (parsed.filters.actor && typeof parsed.filters.actor === 'string') {
      filters.actor = parsed.filters.actor;
    }
    if (parsed.filters.genre && typeof parsed.filters.genre === 'string') {
      filters.genre = parsed.filters.genre;
    }
  }

  return { type, confidence, filters };
}

/**
 * Extract simple filters using regex - used by sync fallback.
 */
function extractSimpleFilters(query: string): QueryFilters {
  const filters: QueryFilters = {};

  for (const { pattern, extract } of DECADE_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      filters.decade = extract(match);
      break;
    }
  }

  const seasonMatch = query.match(SEASON_PATTERN);
  if (seasonMatch) {
    filters.season = parseInt(seasonMatch[1]);
  }

  return filters;
}

/**
 * Keyword-based classification - fallback when LLM is unavailable.
 */
function classifyByKeywords(query: string): { type: QueryType; confidence: number } {
  const queryLower = query.toLowerCase();

  let factualScore = 0;
  let interpretiveScore = 0;

  for (const trigger of FACTUAL_TRIGGERS) {
    if (queryLower.includes(trigger)) {
      factualScore += 1;
    }
  }

  for (const trigger of INTERPRETIVE_TRIGGERS) {
    if (queryLower.includes(trigger)) {
      interpretiveScore += 1;
    }
  }

  const hasDecadeFilter = DECADE_PATTERNS.some((p) => p.pattern.test(query));
  const hasSeasonFilter = SEASON_PATTERN.test(query);
  if (hasDecadeFilter || hasSeasonFilter) {
    factualScore += 0.5;
  }

  if (factualScore >= 1 && interpretiveScore === 0) {
    return { type: 'factual', confidence: Math.min(0.8, 0.5 + factualScore * 0.1) };
  }

  if (interpretiveScore >= 1 && factualScore === 0) {
    return { type: 'interpretive', confidence: Math.min(0.8, 0.5 + interpretiveScore * 0.1) };
  }

  if (factualScore > 0 && interpretiveScore > 0) {
    return { type: 'hybrid', confidence: 0.6 };
  }

  // Default: interpretive with low confidence (fallback is less reliable)
  return { type: 'interpretive', confidence: 0.4 };
}

/**
 * Synchronous fallback - uses only heuristics.
 * Called when LLM is unavailable or for non-critical paths.
 */
export function classifyQuerySync(query: string): ClassificationResult {
  const filters = extractSimpleFilters(query);
  const { type, confidence } = classifyByKeywords(query);

  return { type, confidence, filters };
}
