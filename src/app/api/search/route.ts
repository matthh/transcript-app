import { NextRequest, NextResponse } from 'next/server';
import { queryEpisodes } from '@/lib/metadata-store';
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

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Step 1: Classify query
    const classification = await classifyQuery(query);
    console.log('Classification result:', JSON.stringify(classification));

    let transcriptChunks: TranscriptChunk[] = [];
    let transcriptSources: TranscriptSource[] = [];
    let metadataEpisodes: EpisodeMetadata[] = [];
    let metadataSources: MetadataSource[] = [];

    // Step 2: Search based on classification
    let shouldSearchTranscripts = classification.type === 'interpretive' || classification.type === 'hybrid';

    let metadataTotalCount = 0;
    let metadataHasMore = false;

    // Track if we have an unfiltered result (no meaningful filter applied)
    let isUnfilteredResult = false;

    if (classification.type === 'factual' || classification.type === 'hybrid') {
      console.log('Filters:', JSON.stringify(classification.filters));

      // For factual queries, return all matching episodes (up to 500)
      const result = queryEpisodes(classification.filters, {
        limit: 500,
        sortBy: 'episode',
        sortOrder: 'desc',
      });

      console.log('Query result:', result.returnedCount, 'of', result.totalCount, 'episodes, matched filters:', result.matchedFilters);

      // Check if any meaningful filter was actually applied
      const filtersRequested = Object.keys(classification.filters).length;
      const filtersMatched = result.matchedFilters.length;

      // Detect unfiltered results: filters were expected but none matched
      if (filtersRequested > 0 && filtersMatched === 0) {
        isUnfilteredResult = true;
        console.log('Warning: Filters were extracted but none matched available criteria');
      } else if (filtersMatched === 0 && result.totalCount > 50) {
        isUnfilteredResult = true;
        console.log('Warning: No filters applied, returning all episodes');
      }

      // If unfiltered for a factual query, don't pass all episodes (prevents hallucination)
      if (isUnfilteredResult && classification.type === 'factual') {
        metadataEpisodes = [];
        metadataTotalCount = 0;
        metadataHasMore = false;
        // Don't fall back to transcript search for this case
        shouldSearchTranscripts = false;
      } else {
        metadataEpisodes = result.episodes;
        metadataTotalCount = result.totalCount;
        metadataHasMore = result.hasMore;
        metadataSources = metadataEpisodes.map(episodeToMetadataSource);
      }

      // If factual query found no metadata results, fall back to transcript search
      if (classification.type === 'factual' && metadataEpisodes.length === 0 && !isUnfilteredResult) {
        shouldSearchTranscripts = true;
      }
    }

    if (shouldSearchTranscripts) {
      const { finalK } = getAdaptiveK(classification);
      const hasBM25 = isBM25Available();
      console.log(`Transcript search: K=${finalK}, BM25=${hasBM25 ? 'on' : 'off'}`);

      // Use hybrid retrieval (embedding + BM25) with adaptive K
      const results = await hybridRetrieval(query, classification);

      if (results.length > 0) {
        transcriptChunks = results.map((r) => ({
          id: r.chunk.id,
          text: r.chunk.text,
          episodeTitle: r.chunk.metadata.episodeTitle,
          speakers: r.chunk.metadata.speakers.split(', '),
          startTimestamp: r.chunk.metadata.startTimestamp,
          endTimestamp: r.chunk.metadata.endTimestamp,
        }));

        transcriptSources = results.map((r) => ({
          episodeTitle: r.chunk.metadata.episodeTitle,
          speakers: r.chunk.metadata.speakers,
          startTimestamp: r.chunk.metadata.startTimestamp,
          endTimestamp: r.chunk.metadata.endTimestamp,
          text: r.chunk.text,
          score: r.score,
        }));
      }

      console.log(`Found ${transcriptChunks.length} transcript passages`);
    }

    // Step 3: Build metadata context for synthesis
    const metadataCtx: MetadataContext | undefined = metadataTotalCount > 0
      ? {
          totalCount: metadataTotalCount,
          returnedCount: metadataEpisodes.length,
          hasMore: metadataHasMore,
        }
      : undefined;

    // Step 4: Synthesize answer with Claude
    const answer = await synthesizeHybridAnswer(
      query,
      classification,
      transcriptChunks,
      metadataEpisodes,
      metadataCtx
    );

    // Step 5: Build response with pagination metadata
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
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed. Please try again.' },
      { status: 500 }
    );
  }
}
