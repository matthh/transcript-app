import { NextRequest } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { loadVectorStore, searchSimilar } from '@/lib/vectorstore';
import { queryEpisodes } from '@/lib/metadata-store';
import { classifyQuery } from '@/lib/query-classifier';
import { synthesizeHybridAnswerStreaming } from '@/lib/claude';
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

export async function POST(request: NextRequest) {
  const { query } = await request.json();

  if (!query || typeof query !== 'string') {
    return new Response(JSON.stringify({ error: 'Query is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        // Step 1: Classify query
        send('progress', { stage: 'classifying', message: 'Analyzing your query...' });
        const classification = await classifyQuery(query);
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

        let metadataTotalCount = 0;
        let metadataHasMore = false;

        if (classification.type === 'factual' || classification.type === 'hybrid') {
          send('progress', { stage: 'metadata', message: 'Searching episode data...' });

          console.log('Filters:', JSON.stringify(classification.filters));

          // Always use queryEpisodes for consistent pagination and sorting
          const result = queryEpisodes(classification.filters, {
            limit: 50,
            sortBy: 'episode',
            sortOrder: 'desc',
          });

          metadataEpisodes = result.episodes;
          metadataTotalCount = result.totalCount;
          metadataHasMore = result.hasMore;

          console.log('Query result:', result.returnedCount, 'of', result.totalCount, 'episodes, matched filters:', result.matchedFilters);

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

          // If factual query found no metadata results, fall back to transcript search
          if (classification.type === 'factual' && metadataEpisodes.length === 0) {
            send('progress', { stage: 'fallback', message: 'No metadata found, searching transcripts...' });
            shouldSearchTranscripts = true;
          }
        }

        if (shouldSearchTranscripts) {
          send('progress', { stage: 'transcripts', message: 'Searching transcripts...' });

          const vectorChunks = loadVectorStore();
          if (vectorChunks.length > 0) {
            send('progress', { stage: 'embedding', message: 'Generating embedding...' });
            const queryEmbedding = await generateEmbedding(query);

            send('progress', { stage: 'searching', message: 'Finding relevant passages...' });
            const results = searchSimilar(queryEmbedding, vectorChunks, 10);

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

          send('progress', {
            stage: 'transcripts_done',
            message: `Found ${transcriptChunks.length} relevant passages`,
          });
        }

        // Step 3: Generate answer with streaming
        send('progress', { stage: 'synthesizing', message: 'Generating answer...' });

        let answer = '';
        let chunkCount = 0;

        for await (const chunk of synthesizeHybridAnswerStreaming(
          query,
          classification,
          transcriptChunks,
          metadataEpisodes
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
