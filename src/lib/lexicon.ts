import fs from 'fs';
import path from 'path';

/**
 * Core vocabulary for the Escape Hatch podcast.
 * These terms are always included in word boosting.
 */
const CORE_VOCABULARY = [
  // Host names and nicknames
  'Jason',
  'Haitch',
  'Matt Haitch',
  'Proto',
  'Slim',
  'Corey',
  'Kev',
  'Rosie',
  'Hex',

  // Show-specific terms
  'Escape Hatch',
  'Tapedeck',
  'Dune Pod',
  'mmm',
  "that's great",
  'Tilda',
  'Tilda Swinton Award',
  'H Flex',
  'J Flex',
  'birria',

  // Common mispronunciations
  'Villeneuve',
  'Denis Villeneuve',
  'Timothée Chalamet',
  'Zendaya',
  'Saoirse Ronan',
];

/**
 * Load vocabulary terms from the lexicon candidates file.
 * Returns an array of terms sorted by frequency (most common first).
 */
export function loadLexiconFromFile(): string[] {
  try {
    const lexiconPath = path.join(process.cwd(), 'data', 'lexicon-candidates.txt');

    if (!fs.existsSync(lexiconPath)) {
      console.warn('Lexicon file not found:', lexiconPath);
      return [];
    }

    const content = fs.readFileSync(lexiconPath, 'utf-8');
    const terms: string[] = [];

    for (const line of content.split('\n')) {
      // Skip comments and empty lines
      if (line.startsWith('#') || !line.trim()) continue;

      // Format: term<TAB>count
      const parts = line.split('\t');
      if (parts.length >= 1) {
        const term = parts[0].trim();
        if (term) {
          terms.push(term);
        }
      }
    }

    return terms;
  } catch (error) {
    console.error('Failed to load lexicon:', error);
    return [];
  }
}

/**
 * Get the complete word boost list for AssemblyAI transcription.
 * Combines core vocabulary with terms from the lexicon file.
 *
 * @param maxTerms Maximum number of terms to include (AssemblyAI limit is ~1000)
 * @returns Array of terms for word boosting
 */
export function getWordBoostList(maxTerms: number = 500): string[] {
  const lexiconTerms = loadLexiconFromFile();

  // Combine core vocabulary with lexicon terms, deduplicated
  const allTerms = new Set<string>();

  // Add core vocabulary first (always included)
  for (const term of CORE_VOCABULARY) {
    allTerms.add(term);
  }

  // Add lexicon terms
  for (const term of lexiconTerms) {
    allTerms.add(term);
  }

  // Convert to array and limit
  const result = Array.from(allTerms).slice(0, maxTerms);

  console.log(`Word boost list: ${result.length} terms (${CORE_VOCABULARY.length} core + ${lexiconTerms.length} from lexicon)`);

  return result;
}

/**
 * Get custom spelling corrections for common transcription errors.
 * Format: { from: incorrectSpelling, to: correctSpelling }
 */
export function getCustomSpellings(): Array<{ from: string; to: string }> {
  return [
    { from: 'height', to: 'Haitch' },
    { from: 'hates', to: 'Haitch' },
    { from: 'H', to: 'Haitch' },
    { from: 'hate', to: 'Haitch' },
    { from: 'prodo', to: 'Proto' },
    { from: 'proto', to: 'Proto' },
    { from: 'escape hatch', to: 'Escape Hatch' },
    { from: 'dune pod', to: 'Dune Pod' },
    { from: 'tilda', to: 'Tilda' },
    { from: 'villanueva', to: 'Villeneuve' },
    { from: 'villaneuv', to: 'Villeneuve' },
    { from: 'timothy chalamet', to: 'Timothée Chalamet' },
    { from: 'timothee', to: 'Timothée' },
  ];
}
