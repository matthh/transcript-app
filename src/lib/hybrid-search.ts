import { generateEmbedding } from '@/lib/embeddings';
import { loadVectorStore, searchSimilar } from '@/lib/vectorstore';
import { queryEpisodes, loadEpisodeMetadata } from '@/lib/metadata-store';
import { classifyQuery } from '@/lib/query-classifier';
import { synthesizeHybridAnswer } from '@/lib/claude';
import { TranscriptChunk } from '@/types/transcript';
import {
  HybridSearchResponse,
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

async function searchTranscripts(
  query: string,
  limit: number = 10
): Promise<{ chunks: TranscriptChunk[]; sources: TranscriptSource[] }> {
  const vectorChunks = loadVectorStore();

  if (vectorChunks.length === 0) {
    return { chunks: [], sources: [] };
  }

  const queryEmbedding = await generateEmbedding(query);
  const results = searchSimilar(queryEmbedding, vectorChunks, limit);

  const chunks: TranscriptChunk[] = results.map((r) => ({
    id: r.chunk.id,
    text: r.chunk.text,
    episodeTitle: r.chunk.metadata.episodeTitle,
    speakers: r.chunk.metadata.speakers.split(', '),
    startTimestamp: r.chunk.metadata.startTimestamp,
    endTimestamp: r.chunk.metadata.endTimestamp,
  }));

  const sources: TranscriptSource[] = results.map((r) => ({
    episodeTitle: r.chunk.metadata.episodeTitle,
    speakers: r.chunk.metadata.speakers,
    startTimestamp: r.chunk.metadata.startTimestamp,
    endTimestamp: r.chunk.metadata.endTimestamp,
    text: r.chunk.text,
    score: r.score,
  }));

  return { chunks, sources };
}

function searchMetadata(classification: ClassificationResult): {
  episodes: EpisodeMetadata[];
  sources: MetadataSource[];
} {
  const episodes = loadEpisodeMetadata();

  if (Object.keys(classification.filters).length === 0 && episodes.length > 0) {
    // No specific filters, return all episodes but limit for display
    const limited = episodes.slice(0, 20);
    return {
      episodes: limited,
      sources: limited.map(episodeToMetadataSource),
    };
  }

  const result = queryEpisodes(classification.filters);

  return {
    episodes: result.episodes,
    sources: result.episodes.map(episodeToMetadataSource),
  };
}

export async function hybridSearch(
  query: string
): Promise<HybridSearchResponse> {
  // Step 1: Classify the query
  const classification = await classifyQuery(query);

  // Step 2: Route based on classification
  let transcriptChunks: TranscriptChunk[] = [];
  let transcriptSources: TranscriptSource[] = [];
  let metadataEpisodes: EpisodeMetadata[] = [];
  let metadataSources: MetadataSource[] = [];

  switch (classification.type) {
    case 'factual': {
      // Only query metadata
      const metadataResult = searchMetadata(classification);
      metadataEpisodes = metadataResult.episodes;
      metadataSources = metadataResult.sources;
      break;
    }

    case 'interpretive': {
      // Only search transcripts
      const transcriptResult = await searchTranscripts(query);
      transcriptChunks = transcriptResult.chunks;
      transcriptSources = transcriptResult.sources;
      break;
    }

    case 'hybrid': {
      // Parallel retrieval from both sources
      const [metadataResult, transcriptResult] = await Promise.all([
        Promise.resolve(searchMetadata(classification)),
        searchTranscripts(query),
      ]);

      metadataEpisodes = metadataResult.episodes;
      metadataSources = metadataResult.sources;
      transcriptChunks = transcriptResult.chunks;
      transcriptSources = transcriptResult.sources;
      break;
    }
  }

  // Step 3: Synthesize answer with Claude
  const answer = await synthesizeHybridAnswer(
    query,
    classification,
    transcriptChunks,
    metadataEpisodes
  );

  // Step 4: Build response
  const response: HybridSearchResponse = {
    answer,
    queryType: classification.type,
    sources: {},
  };

  if (transcriptSources.length > 0) {
    response.sources.transcripts = transcriptSources;
  }

  if (metadataSources.length > 0) {
    response.sources.metadata = metadataSources;
  }

  return response;
}

export { classifyQuery } from '@/lib/query-classifier';
