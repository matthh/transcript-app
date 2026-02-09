import { NextRequest } from 'next/server';
import { queryEpisodes } from '@/lib/metadata-store';
import { classifyQuery } from '@/lib/query-classifier';
import { detectQueryIntent } from '@/lib/query-intent';
import { buildMetadataAggregateResponse } from '@/lib/metadata-aggregates';
import { isBM25Loaded } from '@/lib/bm25-loader';
import { getVectorStoreSize, isVectorStoreLoaded } from '@/lib/vectorstore';
import { getSearchTuning } from '@/lib/search-tuning';
import { synthesizeHybridAnswerStreaming, MetadataContext } from '@/lib/claude';
import { hybridRetrieval, isBM25Available, getAdaptiveK } from '@/lib/hybrid-retrieval';
import { TranscriptChunk } from '@/types/transcript';
import {
  MetadataSource,
  TranscriptSource,
  EpisodeMetadata,
  ClassificationResult,
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
  const body = await request.json();
  const { query, limit: rawLimit, offset: rawOffset, variant } = body;

  if (!query || typeof query !== 'string') {
    return new Response(JSON.stringify({ error: 'Query is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse and validate pagination params
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, typeof rawLimit === 'number' ? rawLimit : DEFAULT_LIMIT)
  );
  const offset = Math.max(0, typeof rawOffset === 'number' ? rawOffset : 0);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const requestStart = Date.now();
        if (!loggedCacheStatus) {
          loggedCacheStatus = true;
          console.log('Search cache status', {
            vectorStoreLoaded: isVectorStoreLoaded(),
            vectorStoreSize: getVectorStoreSize(),
            bm25Loaded: isBM25Loaded(),
          });
        }

        const allowVariants = process.env.ALLOW_VARIANTS === '1' || process.env.NODE_ENV !== 'production';
        const requestedVariant = typeof variant === 'string' ? variant : undefined;
        let tuning = allowVariants ? getSearchTuning(requestedVariant) : null;
        // Intent detection (pre-classification routing)
        const intent = detectQueryIntent(query);
        if (intent.type !== 'none') {
          const aggregate = buildMetadataAggregateResponse(intent);
          if (aggregate) {
            const totalMs = Date.now() - requestStart;
            send('progress', { stage: 'metadata', message: 'Answering from metadata...' });
            send('complete', {
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
            controller.close();
            return;
          }
        }

        // Step 1: Classify query
        send('progress', { stage: 'classifying', message: 'Analyzing your query...' });
        let classification = await classifyQuery(query);
        if (intent.type === 'transcript_only') {
          classification = { ...classification, type: 'interpretive', filters: {} };
        }
        if (classification.type === 'interpretive' && !tuning) {
          tuning = getSearchTuning('fast');
        }
        console.log('Classification result:', JSON.stringify(classification));
        send('progress', {
          stage: 'classified',
          message: `Query type: ${classification.type}`,
          queryType: classification.type,
        });

        let transcriptChunks: TranscriptChunk[] = [];
        let transcriptSources: TranscriptSource[] = [];
        let metadataEpisodes: EpisodeMetadata[] = [];
        let metadataSources: MetadataSource[] = [];

        // Step 2: Search based on classification
        let shouldSearchTranscripts = classification.type === 'interpretive' || classification.type === 'hybrid';
        if (intent.type === 'transcript_only') {
          shouldSearchTranscripts = true;
        }

        let metadataTotalCount = 0;
        let metadataHasMore = false;

        // Track if we have an unfiltered result (no meaningful filter applied)
        let isUnfilteredResult = false;

        if (classification.type === 'factual' || classification.type === 'hybrid') {
          send('progress', { stage: 'metadata', message: 'Searching episode data...' });

          console.log('Filters:', JSON.stringify(classification.filters));

          // For factual queries, use client-provided pagination (capped at MAX_LIMIT)
          const result = queryEpisodes(classification.filters, {
            limit,
            offset,
            sortBy: 'episode',
            sortOrder: 'desc',
          });

          console.log('Query result:', result.returnedCount, 'of', result.totalCount, 'episodes, matched filters:', result.matchedFilters);

          // Check if any meaningful filter was actually applied
          // If no filters matched and we got almost all episodes, the filter didn't work
          const filtersRequested = Object.keys(classification.filters).length;
          const filtersMatched = result.matchedFilters.length;

          // Detect unfiltered results: filters were expected but none matched
          // OR query mentions specific criteria but we returned nearly all episodes
          if (filtersRequested > 0 && filtersMatched === 0) {
            // User's query had filters extracted but none matched our schema
            isUnfilteredResult = true;
            console.log('Warning: Filters were extracted but none matched available criteria');
          } else if (filtersMatched === 0 && result.totalCount > 50) {
            // No filters and returning all episodes - might be asking about unsupported criteria
            isUnfilteredResult = true;
            console.log('Warning: No filters applied, returning all episodes');
          }

          // If unfiltered for a factual query, don't pass all episodes (prevents hallucination)
          if (isUnfilteredResult && classification.type === 'factual' && intent.type !== 'transcript_only') {
            metadataEpisodes = [];
            metadataTotalCount = 0;
            metadataHasMore = false;
            send('progress', {
              stage: 'metadata_done',
              message: 'No episodes match the specified criteria',
              totalCount: 0,
              hasMore: false,
              warning: 'No episodes matched the filter criteria. The database can filter by: film title, decade, season, guest, reviewer, director, cinematographer, actor, or genre.',
            });
            // DON'T fall back to transcript search for this case - it will just return
            // irrelevant passages and confuse the user. Let the "no data" message show.
            shouldSearchTranscripts = false;
          } else {
            metadataEpisodes = result.episodes;
            metadataTotalCount = result.totalCount;
            metadataHasMore = result.hasMore;
            metadataSources = metadataEpisodes.map(episodeToMetadataSource);

            const countMessage = metadataHasMore
              ? `Found ${result.returnedCount} of ${result.totalCount} episodes`
              : `Found ${result.totalCount} episodes`;
            send('progress', {
              stage: 'metadata_done',
              message: countMessage,
              totalCount: metadataTotalCount,
              hasMore: metadataHasMore,
            });
          }

          // If factual query found no metadata results, fall back to transcript search
          if (classification.type === 'factual' && metadataEpisodes.length === 0 && !isUnfilteredResult) {
            send('progress', { stage: 'fallback', message: 'No metadata found, searching transcripts...' });
            shouldSearchTranscripts = true;
          }
        }

        if (shouldSearchTranscripts) {
          send('progress', { stage: 'transcripts', message: 'Searching transcripts...' });

          const baseK = getAdaptiveK(classification);
          const interpretiveOverrides = classification.type === 'interpretive' ? tuning?.interpretiveK : undefined;
          const finalK = interpretiveOverrides?.finalK ?? baseK.finalK;
          const hasBM25 = isBM25Available();

          send('progress', {
            stage: 'embedding',
            message: hasBM25 ? 'Running hybrid search (embedding + lexical)...' : 'Generating embedding...',
          });

          // Use hybrid retrieval (embedding + BM25) with adaptive K
          const results = await hybridRetrieval(query, classification, interpretiveOverrides);

          if (results.length > 0) {
            send('progress', {
              stage: 'searching',
              message: `Found ${results.length} passages (K=${finalK}, BM25=${hasBM25 ? 'on' : 'off'})`,
            });

            transcriptChunks = results.map((r) => ({
              id: r.chunk.id,
              text: r.chunk.text,
              episodeTitle: r.chunk.metadata.episodeTitle,
              speakers: r.chunk.metadata.speakers.split(', '),
              startTimestamp: r.chunk.metadata.startTimestamp,
              endTimestamp: r.chunk.metadata.endTimestamp,
            }));

            transcriptSources = results.map((r) => {
              // Extract episode number from chunk ID (e.g., "episode_182_chunk_5" -> 182)
              const epMatch = r.chunk.id.match(/episode_(\d+)/i);
              const episodeNumber = epMatch ? parseInt(epMatch[1], 10) : undefined;
              return {
                episodeTitle: r.chunk.metadata.episodeTitle,
                episodeNumber,
                speakers: r.chunk.metadata.speakers,
                startTimestamp: r.chunk.metadata.startTimestamp,
                endTimestamp: r.chunk.metadata.endTimestamp,
                text: r.chunk.text,
                score: r.score,
              };
            });
          }

          send('progress', {
            stage: 'transcripts_done',
            message: `Found ${transcriptChunks.length} relevant passages`,
          });
        }

        // Step 3: Generate answer with streaming
        send('progress', { stage: 'synthesizing', message: 'Generating answer...' });

        // Build metadata context for synthesis
        const metadataCtx: MetadataContext | undefined = metadataTotalCount > 0
          ? {
              totalCount: metadataTotalCount,
              returnedCount: metadataEpisodes.length,
              hasMore: metadataHasMore,
            }
          : undefined;

        let answer = '';
        let chunkCount = 0;

        const interpretiveTuning = classification.type === 'interpretive'
          ? {
              model: tuning?.interpretiveModel,
              maxTokens: tuning?.interpretiveMaxTokens,
            }
          : undefined;

        for await (const chunk of synthesizeHybridAnswerStreaming(
          query,
          classification,
          transcriptChunks,
          metadataEpisodes,
          metadataCtx,
          interpretiveTuning
        )) {
          if (chunk.type === 'chunk') {
            chunkCount++;
            // Send streaming chunks periodically to show progress
            if (chunkCount % 5 === 0) {
              send('progress', {
                stage: 'streaming',
                message: `Writing response... (${answer.length} chars)`
              });
            }
            answer += chunk.text;
            send('chunk', { text: chunk.text });
          } else if (chunk.type === 'done') {
            answer = chunk.text;
          }
        }

        // Step 4: Send final result
        const totalMs = Date.now() - requestStart;
        send('complete', {
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

        controller.close();
      } catch (error) {
        console.error('Search error:', error);
        let errorMessage = 'Unknown error';
        if (error instanceof Error) {
          errorMessage = error.message;
          if ('cause' in error && error.cause) {
            errorMessage += ` (cause: ${String(error.cause)})`;
          }
          if ('status' in error) {
            errorMessage += ` (status: ${(error as { status: number }).status})`;
          }
        }
        send('error', { message: `Search failed: ${errorMessage}` });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
