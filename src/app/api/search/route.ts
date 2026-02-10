import { NextRequest, NextResponse } from 'next/server';
import { queryEpisodes } from '@/lib/metadata-store';
import { detectQueryIntent } from '@/lib/query-intent';
import { buildMetadataAggregateResponse } from '@/lib/metadata-aggregates';
import { isBM25Loaded } from '@/lib/bm25-loader';
import { getVectorStoreSize, isVectorStoreLoaded } from '@/lib/vectorstore';
import { getSearchTuning } from '@/lib/search-tuning';
import { classifyQuery } from '@/lib/query-classifier';
import { synthesizeHybridAnswer, MetadataContext } from '@/lib/claude';
import { hybridRetrieval, isBM25Available, getAdaptiveK } from '@/lib/hybrid-retrieval';
import { TranscriptChunk } from '@/types/transcript';
import {
  MetadataSource,
  TranscriptSource,
  EpisodeMetadata,
} from '@/types/episode-metadata';

function episodeToMetadataSource(episode: EpisodeMetadata): MetadataSource {
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


const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
let loggedCacheStatus = false;


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, limit: rawLimit, offset: rawOffset, variant } = body;

    const requestStart = Date.now();

    if (!loggedCacheStatus) {
      loggedCacheStatus = true;
      console.log('Search cache status', {
        vectorStoreLoaded: isVectorStoreLoaded(),
        vectorStoreSize: getVectorStoreSize(),
        bm25Loaded: isBM25Loaded(),
      });
    }

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Parse and validate pagination params
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, typeof rawLimit === 'number' ? rawLimit : DEFAULT_LIMIT)
    );
    const offset = Math.max(0, typeof rawOffset === 'number' ? rawOffset : 0);

    // Step 1: Intent detection (pre-classification routing)
    const intent = detectQueryIntent(query);
    if (intent.type !== 'none') {
      const aggregate = buildMetadataAggregateResponse(intent);
      if (aggregate) {
        const totalMs = Date.now() - requestStart;
        return NextResponse.json({
          answer: aggregate.answer,
          queryType: 'factual',
          sources: aggregate.sources,
          metadata: {
            totalCount: aggregate.sources.metadata?.length || 0,
            returnedCount: aggregate.sources.metadata?.length || 0,
            hasMore: false,
          },
          perf: {
            totalMs,
            path: 'metadata',
          },
        });
      }
    }

    const allowVariants = process.env.ALLOW_VARIANTS === '1' || process.env.NODE_ENV !== 'production';
    const requestedVariant = typeof variant === 'string' ? variant : undefined;
    let tuning = allowVariants ? getSearchTuning(requestedVariant) : null;

    // Step 2: Classify query (for filter extraction + synthesis prompt hint)
    const classification = await classifyQuery(query);
    if (classification.type === 'interpretive' && !tuning) {
      tuning = getSearchTuning('fast');
    }
    console.log('Classification result:', JSON.stringify(classification));

    let transcriptChunks: TranscriptChunk[] = [];
    let transcriptSources: TranscriptSource[] = [];
    let metadataEpisodes: EpisodeMetadata[] = [];
    let metadataSources: MetadataSource[] = [];
    let metadataTotalCount = 0;
    let metadataHasMore = false;

    // Step 3: Always search both metadata + transcripts
    // Metadata search — uses extracted filters to narrow results
    console.log('Filters:', JSON.stringify(classification.filters));

    let result = queryEpisodes(classification.filters, {
      limit,
      offset,
      sortBy: 'episode',
      sortOrder: 'desc',
    });

    console.log('Query result:', result.returnedCount, 'of', result.totalCount, 'episodes, matched filters:', result.matchedFilters);

    // Fallback: if year filters exist but LLM's other filters produced 0 results,
    // retry with only year-based filters (decade/yearRange)
    if (result.totalCount === 0 && (classification.filters.yearRange || classification.filters.decade)) {
      const yearOnlyFilters: typeof classification.filters = {};
      if (classification.filters.decade) yearOnlyFilters.decade = classification.filters.decade;
      if (classification.filters.yearRange) yearOnlyFilters.yearRange = classification.filters.yearRange;
      console.log('Year-filter fallback:', JSON.stringify(yearOnlyFilters));
      result = queryEpisodes(yearOnlyFilters, { limit, offset, sortBy: 'episode', sortOrder: 'desc' });
      console.log('Fallback result:', result.returnedCount, 'of', result.totalCount);
    }

    // Only include metadata if meaningful filters matched (avoid passing all 300+ episodes)
    const filtersRequested = Object.keys(classification.filters).length;
    const filtersMatched = result.matchedFilters.length;
    if (filtersMatched > 0 || (filtersRequested === 0 && result.totalCount <= 50)) {
      metadataEpisodes = result.episodes;
      metadataTotalCount = result.totalCount;
      metadataHasMore = result.hasMore;
      metadataSources = metadataEpisodes.map(episodeToMetadataSource);
    }

    // Transcript search — always run
    const baseK = getAdaptiveK(classification);
    const interpretiveOverrides = classification.type === 'interpretive' ? tuning?.interpretiveK : undefined;
    const hasBM25 = isBM25Available();
    console.log(`Transcript search: K=${baseK.finalK}, BM25=${hasBM25 ? 'on' : 'off'}`);

    const isColdStart = !isVectorStoreLoaded();
    const retrievalOptions = isColdStart ? { timeoutMs: 15000 } : undefined;
    const retrievalResults = await hybridRetrieval(query, classification, interpretiveOverrides, retrievalOptions);
    const transcriptTimedOut = isColdStart && retrievalResults.length === 0;

    if (retrievalResults.length > 0) {
      transcriptChunks = retrievalResults.map((r) => ({
        id: r.chunk.id,
        text: r.chunk.text,
        episodeTitle: r.chunk.metadata.episodeTitle,
        speakers: r.chunk.metadata.speakers.split(', '),
        startTimestamp: r.chunk.metadata.startTimestamp,
        endTimestamp: r.chunk.metadata.endTimestamp,
      }));

      transcriptSources = retrievalResults.map((r) => ({
        episodeTitle: r.chunk.metadata.episodeTitle,
        speakers: r.chunk.metadata.speakers,
        startTimestamp: r.chunk.metadata.startTimestamp,
        endTimestamp: r.chunk.metadata.endTimestamp,
        text: r.chunk.text,
        score: r.score,
      }));
    }

    console.log(`Found ${transcriptChunks.length} transcript passages`);

    // Build metadata context for synthesis
    const metadataCtx: MetadataContext | undefined = metadataTotalCount > 0
      ? {
          totalCount: metadataTotalCount,
          returnedCount: metadataEpisodes.length,
          hasMore: metadataHasMore,
        }
      : undefined;

    // Step 4: Synthesize answer with Claude
    const interpretiveTuning = classification.type === 'interpretive'
      ? {
          model: tuning?.interpretiveModel,
          maxTokens: tuning?.interpretiveMaxTokens,
        }
      : undefined;

    let answer = await synthesizeHybridAnswer(
      query,
      classification,
      transcriptChunks,
      metadataEpisodes,
      metadataCtx,
      interpretiveTuning
    );

    if (transcriptTimedOut && metadataTotalCount > 0) {
      answer += '\n\n---\n*Transcript search is still loading — showing metadata results. Try again for full search.*';
    }

    // Step 5: Build response with pagination metadata
    const totalMs = Date.now() - requestStart;
    return NextResponse.json({
      answer,
      queryType: classification.type,
      sources: {
        transcripts: transcriptSources.length > 0 ? transcriptSources : undefined,
        metadata: metadataSources.length > 0 ? metadataSources : undefined,
      },
      metadata: {
        totalCount: metadataTotalCount,
        returnedCount: metadataEpisodes.length,
        hasMore: metadataHasMore,
      },
      perf: {
        totalMs,
        path: classification.type,
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed. Please try again.' },
      { status: 500 }
    );
  }
}
