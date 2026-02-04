export interface EpisodeMetadata {
  pod: string;
  season: number;
  episode: number;
  film: string;
  filmYear: number | null;
  releaseDate: string;
  length: string;
  reviewer: string;
  guest: string | null;
  mmmCount: number;
  thatsGreatCount: number;
  notableMoments: string;
  hFlex: string;
  jFlex: string;
  kevsQuestion: string;
  tildaH: string;
  tildaJason: string;
  tildaGuest: string | null;
  tildaCorey: string | null;
  showLink: string;
  artworkLink: string;
  letterboxdLink: string;
  imdbLink: string;
}

export interface QueryFilters {
  decade?: number;
  season?: number;
  guest?: string;
  film?: string;
  reviewer?: string;
  yearRange?: { min: number; max: number };
}

export interface PaginationOptions {
  limit?: number;   // Max results to return (default: 50)
  offset?: number;  // Skip first N results (default: 0)
  sortBy?: 'episode' | 'releaseDate' | 'filmYear';  // Sort field (default: 'episode')
  sortOrder?: 'asc' | 'desc';  // Sort direction (default: 'desc' for most recent first)
}

export interface MetadataQueryResult {
  episodes: EpisodeMetadata[];
  totalCount: number;        // Total matching episodes (before pagination)
  returnedCount: number;     // Number returned in this response
  hasMore: boolean;          // Whether there are more results
  matchedFilters: string[];
}

export interface MetadataSource {
  film: string;
  season: number;
  episode: number;
  releaseDate: string;
  guest: string | null;
  reviewer: string;
  relevantFields: Record<string, string>;
}

export interface TranscriptSource {
  episodeTitle: string;
  speakers: string;
  startTimestamp: string;
  endTimestamp: string;
  text: string;
  score: number;
}

export type QueryType = 'factual' | 'interpretive' | 'hybrid';

export interface ClassificationResult {
  type: QueryType;
  confidence: number;
  filters: QueryFilters;
}

export interface HybridSearchResponse {
  answer: string;
  queryType: QueryType;
  sources: {
    transcripts?: TranscriptSource[];
    metadata?: MetadataSource[];
  };
}
