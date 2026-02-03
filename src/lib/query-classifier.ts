import Anthropic from '@anthropic-ai/sdk';
import {
  QueryType,
  QueryFilters,
  ClassificationResult,
} from '@/types/episode-metadata';

const FACTUAL_TRIGGERS = [
  'how many',
  'count',
  'list',
  'which episodes',
  'which movies',
  'which films',
  'what movies',
  'what films',
  'total',
  'longest',
  'shortest',
  'when did',
  'what episode',
  'who was the guest',
  'who reviewed',
  'what film',
  'what movie',
  'all episodes',
  'every episode',
  'number of',
];

const INTERPRETIVE_TRIGGERS = [
  'what did they think',
  'opinion',
  'feel about',
  'favorite',
  'favourite',
  'what did',
  'how did',
  'why did',
  'thoughts on',
  'reaction to',
  'perspective',
  'analysis',
  'discussion',
  'talked about',
  'said about',
  'mentioned',
  // Triggers for questions about what someone said/wants/thinks
  ' said ',        // "rosie said she wants" - space-padded to avoid "said about" double-counting
  ' say ',         // "did they say"
  'wants to',      // "wants to cover"
  'want to',       // "did they want to"
  'thinks about',  // "what rosie thinks about"
  'think about',   // "what do they think about"
];

const DECADE_PATTERNS = [
  { pattern: /\b(19[0-9]0)s\b/i, extract: (m: RegExpMatchArray) => parseInt(m[1]) },
  { pattern: /\b(20[0-9]0)s\b/i, extract: (m: RegExpMatchArray) => parseInt(m[1]) },
  // Short forms like "90s", "80s" - assume 1900s for 20-90, 2000s for 00-10
  { pattern: /\b([2-9]0)s\b/i, extract: (m: RegExpMatchArray) => 1900 + parseInt(m[1]) },
  { pattern: /\b(00)s\b/i, extract: () => 2000 },
  { pattern: /\b(10)s\b/i, extract: () => 2010 },
  // Word forms
  { pattern: /\beighties\b/i, extract: () => 1980 },
  { pattern: /\bnineties\b/i, extract: () => 1990 },
  { pattern: /\bseventies\b/i, extract: () => 1970 },
  { pattern: /\bsixties\b/i, extract: () => 1960 },
  { pattern: /\bfifties\b/i, extract: () => 1950 },
];

const SEASON_PATTERN = /\bseason\s*(\d+)\b/i;

/**
 * Extract only unambiguous filters (decade, season) using regex.
 * Guest/film extraction is delegated to LLM for reliability.
 */
function extractSimpleFilters(query: string): QueryFilters {
  const filters: QueryFilters = {};

  // Extract decade - these patterns are unambiguous
  for (const { pattern, extract } of DECADE_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      filters.decade = extract(match);
      break;
    }
  }

  // Extract season - also unambiguous
  const seasonMatch = query.match(SEASON_PATTERN);
  if (seasonMatch) {
    filters.season = parseInt(seasonMatch[1]);
  }

  return filters;
}

/**
 * Classify query type using keyword heuristics.
 * Returns the query type but NOT filters (those come from LLM for factual queries).
 */
function classifyByKeywords(query: string): { type: QueryType; confidence: number } | null {
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

  // Check for decade/season filters which suggest metadata queries
  const hasDecadeFilter = DECADE_PATTERNS.some((p) => p.pattern.test(query));
  const hasSeasonFilter = SEASON_PATTERN.test(query);
  if (hasDecadeFilter || hasSeasonFilter) {
    factualScore += 0.5;
  }

  // Strong factual signal
  if (factualScore >= 1 && interpretiveScore === 0) {
    return { type: 'factual', confidence: Math.min(0.9, 0.6 + factualScore * 0.1) };
  }

  // Strong interpretive signal
  if (interpretiveScore >= 1 && factualScore === 0) {
    return { type: 'interpretive', confidence: Math.min(0.9, 0.6 + interpretiveScore * 0.1) };
  }

  // Both signals present = hybrid
  if (factualScore > 0 && interpretiveScore > 0) {
    return { type: 'hybrid', confidence: 0.7 };
  }

  // Decade/filter + opinion keywords = hybrid
  if ((hasDecadeFilter || hasSeasonFilter) && interpretiveScore > 0) {
    return { type: 'hybrid', confidence: 0.8 };
  }

  return null;
}

export async function classifyQuery(query: string): Promise<ClassificationResult> {
  // Extract simple, unambiguous filters (decade, season) via regex
  const simpleFilters = extractSimpleFilters(query);

  // Classify query type using keyword heuristics
  const keywordResult = classifyByKeywords(query);
  const queryType = keywordResult?.type || 'interpretive';
  const confidence = keywordResult?.confidence || 0.5;

  // For interpretive queries, we don't need entity extraction
  if (queryType === 'interpretive') {
    return {
      type: 'interpretive',
      confidence,
      filters: simpleFilters,
    };
  }

  // For factual/hybrid queries, ALWAYS use LLM for entity extraction
  // This handles guest names, film titles, and other entities that regex can't reliably extract
  try {
    const llmResult = await extractFiltersWithLLM(query);
    return {
      type: queryType,
      confidence,
      // Merge: simple filters as base, LLM filters override (LLM is more reliable for entities)
      filters: { ...simpleFilters, ...llmResult.filters },
    };
  } catch (error) {
    console.warn('LLM filter extraction failed, using simple filters only:', error);
    return {
      type: queryType,
      confidence: confidence * 0.8, // Lower confidence when LLM fails
      filters: simpleFilters,
    };
  }
}

/**
 * Use LLM (Claude Haiku) to extract structured filters from natural language queries.
 * This handles complex entity extraction like guest names, film titles, etc.
 * that regex patterns cannot reliably extract.
 */
async function extractFiltersWithLLM(query: string): Promise<{ filters: QueryFilters }> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const message = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Extract structured filters from this podcast search query.

Query: "${query}"

Extract these filters if present:
- guest: A person's name who appeared as a guest (NOT question words like "who", "what")
- film: The film/movie title being asked about
- reviewer: A reviewer/host name if specifically mentioned
- decade: Year like 1980 for "80s movies" (only if not obvious from text)
- season: Season number like 2 for "season 2" (only if not obvious from text)

IMPORTANT RULES:
1. "who was the guest on close encounters" → film: "close encounters" (the question asks ABOUT a film)
2. "how many episodes was meredith a guest on" → guest: "meredith" (meredith is the guest being asked about)
3. "what episodes had Proto as guest" → guest: "Proto"
4. "which 80s movies did they review" → decade: 1980
5. Do NOT extract question words (who, what, which, how) as entity values
6. Film titles may be partial - extract what's given (e.g., "close encounters" not "Close Encounters of the Third Kind")

Respond with ONLY a JSON object:
{"filters": {"guest?": "string", "film?": "string", "reviewer?": "string", "decade?": number, "season?": number}}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('No text response from LLM');
  }

  // Extract JSON from response
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM response');
  }

  const result = JSON.parse(jsonMatch[0]);

  // Clean up filters - remove undefined/null values
  const filters: QueryFilters = {};
  if (result.filters) {
    if (result.filters.guest) filters.guest = result.filters.guest;
    if (result.filters.film) filters.film = result.filters.film;
    if (result.filters.reviewer) filters.reviewer = result.filters.reviewer;
    if (result.filters.decade) filters.decade = result.filters.decade;
    if (result.filters.season) filters.season = result.filters.season;
  }

  return { filters };
}

/**
 * Synchronous version - uses only simple regex filters.
 * For factual queries, the async version should be preferred as it uses LLM.
 */
export function classifyQuerySync(query: string): ClassificationResult {
  const filters = extractSimpleFilters(query);
  const keywordResult = classifyByKeywords(query);

  if (keywordResult) {
    return {
      ...keywordResult,
      filters,
    };
  }

  // Default to interpretive for unknown queries
  return {
    type: 'interpretive',
    confidence: 0.5,
    filters,
  };
}
