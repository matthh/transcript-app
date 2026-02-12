/**
 * BM25 (Best Matching 25) lexical search implementation.
 * Complements embedding search by catching exact term matches.
 */

export interface BM25Document {
  id: string;
  text: string;
  metadata: {
    episodeTitle: string;
    speakers: string;
    startTimestamp: string;
    endTimestamp: string;
  };
}

export interface BM25Index {
  // Document frequency: term -> number of docs containing term
  df: Record<string, number>;
  // Inverted index: term -> array of [docIndex, termFrequency]
  invertedIndex: Record<string, [number, number][]>;
  // Document lengths (in tokens)
  docLengths: number[];
  // Average document length
  avgDocLength: number;
  // Total number of documents
  numDocs: number;
  // Document IDs for lookup
  docIds: string[];
}

// BM25 parameters
const K1 = 1.5; // Term frequency saturation
const B = 0.75; // Document length normalization

/** Podcast-specific synonym expansions for BM25 search. */
const SYNONYM_MAP: Record<string, string[]> = {
  'voicemail': ['letter', 'letters'],
  'voicemails': ['letters', 'letter'],
  'letter': ['voicemail', 'voicemails'],
  'letters': ['voicemails', 'voicemail'],
};

/**
 * Expand query tokens with synonyms.
 * Returns original tokens + any synonym expansions (deduplicated).
 */
export function expandQueryTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const synonyms = SYNONYM_MAP[token];
    if (synonyms) {
      for (const syn of synonyms) {
        expanded.add(syn);
      }
    }
  }
  return Array.from(expanded);
}

/**
 * Tokenize text into searchable terms.
 * Simple whitespace + punctuation tokenizer with lowercasing.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ') // Keep apostrophes and hyphens
    .split(/\s+/)
    .filter((token) => token.length > 1); // Remove single chars
}

/**
 * Build a BM25 index from documents.
 */
export function buildBM25Index(documents: BM25Document[]): BM25Index {
  const df: Record<string, number> = {};
  const invertedIndex: Record<string, [number, number][]> = {};
  const docLengths: number[] = [];
  const docIds: string[] = [];
  let totalLength = 0;

  // First pass: build term frequencies and document frequencies
  documents.forEach((doc, docIndex) => {
    const tokens = tokenize(doc.text);
    docLengths.push(tokens.length);
    docIds.push(doc.id);
    totalLength += tokens.length;

    // Count term frequencies in this document
    const termFreqs: Record<string, number> = {};
    for (const token of tokens) {
      termFreqs[token] = (termFreqs[token] || 0) + 1;
    }

    // Update document frequency and inverted index
    for (const [term, freq] of Object.entries(termFreqs)) {
      if (!invertedIndex[term]) {
        invertedIndex[term] = [];
        df[term] = 0;
      }
      invertedIndex[term].push([docIndex, freq]);
      df[term]++;
    }
  });

  return {
    df,
    invertedIndex,
    docLengths,
    avgDocLength: totalLength / documents.length,
    numDocs: documents.length,
    docIds,
  };
}

/**
 * Calculate BM25 score for a single term in a document.
 */
function termScore(
  tf: number,
  docLength: number,
  avgDocLength: number,
  df: number,
  numDocs: number
): number {
  // IDF component
  const idf = Math.log((numDocs - df + 0.5) / (df + 0.5) + 1);

  // TF component with saturation and length normalization
  const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLength / avgDocLength)));

  return idf * tfNorm;
}

/**
 * Search the BM25 index for documents matching the query.
 */
export function searchBM25(
  query: string,
  index: BM25Index,
  topK: number = 10
): { docId: string; score: number; docIndex: number }[] {
  const queryTokens = expandQueryTokens(tokenize(query));

  if (queryTokens.length === 0) {
    return [];
  }

  // Calculate scores for all documents that contain at least one query term
  const scores: Record<number, number> = {};

  for (const token of queryTokens) {
    const postings = index.invertedIndex[token];
    if (!postings) continue;

    const docFreq = index.df[token];

    for (const [docIndex, termFreq] of postings) {
      const score = termScore(
        termFreq,
        index.docLengths[docIndex],
        index.avgDocLength,
        docFreq,
        index.numDocs
      );

      scores[docIndex] = (scores[docIndex] || 0) + score;
    }
  }

  // Sort by score and return top K
  const results = Object.entries(scores)
    .map(([docIndex, score]) => ({
      docId: index.docIds[parseInt(docIndex)],
      score,
      docIndex: parseInt(docIndex),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return results;
}

/**
 * Serialize BM25 index to JSON for bundling.
 */
export function serializeBM25Index(index: BM25Index): string {
  return JSON.stringify(index);
}

/**
 * Deserialize BM25 index from JSON.
 */
export function deserializeBM25Index(json: string): BM25Index {
  return JSON.parse(json);
}
