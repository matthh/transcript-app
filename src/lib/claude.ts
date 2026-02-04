import Anthropic from '@anthropic-ai/sdk';
import { TranscriptChunk } from '@/types/transcript';
import {
  EpisodeMetadata,
  ClassificationResult,
} from '@/types/episode-metadata';

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

export async function answerQuestion(
  question: string,
  chunks: TranscriptChunk[]
): Promise<string> {
  const context = chunks
    .map((chunk, i) => {
      return `[Source ${i + 1}]
Episode: ${chunk.episodeTitle}
Speakers: ${chunk.speakers.join(', ')}
Timestamp: ${chunk.startTimestamp} - ${chunk.endTimestamp}
---
${chunk.text}
---`;
    })
    .join('\n\n');

  const message = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are a helpful assistant that answers questions about the Escape Hatch podcast. Based on the following podcast excerpts, answer the question thoughtfully.

Always refer to "Matt Haitch" or "Haitch Matt" as just "Haitch".

Your response style should match the question:
- For interpretive questions (e.g., "What do they think about X?", "How do they feel about Y?"): Provide an expansive, analytical answer that synthesizes the hosts' perspectives, themes, and opinions. Use references with timestamps to illustrate and support your interpretation, but don't just list quotes.
- For specific questions (e.g., "What did Jason say about X?", "When did they mention Y?"): Provide direct quotes with episode names, speakers, and timestamps.

If the excerpts don't contain relevant information, say so clearly.

PODCAST EXCERPTS:
${context}

QUESTION: ${question}

Provide a thoughtful answer based on the excerpts above.`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text : 'Unable to generate a response.';
}

function formatTranscriptContext(chunks: TranscriptChunk[]): string {
  if (chunks.length === 0) return '';

  return chunks
    .map((chunk, i) => {
      return `[Transcript ${i + 1}]
Episode: ${chunk.episodeTitle}
Speakers: ${chunk.speakers.join(', ')}
Timestamp: ${chunk.startTimestamp} - ${chunk.endTimestamp}
---
${chunk.text}
---`;
    })
    .join('\n\n');
}

function formatMetadataContext(episodes: EpisodeMetadata[]): string {
  if (episodes.length === 0) return '';

  return episodes
    .map((ep, i) => {
      const parts = [
        `[Episode ${i + 1}]`,
        `Film: ${ep.film}`,
        `Season ${ep.season}, Episode ${ep.episode}`,
        `Release Date: ${ep.releaseDate}`,
        `Length: ${ep.length}`,
        `Reviewer: ${ep.reviewer}`,
      ];

      if (ep.guest) {
        parts.push(`Guest: ${ep.guest}`);
      }

      if (ep.notableMoments) {
        parts.push(`Notable Moments: ${ep.notableMoments}`);
      }

      if (ep.mmmCount > 0) {
        parts.push(`MMM Count: ${ep.mmmCount}`);
      }

      if (ep.thatsGreatCount > 0) {
        parts.push(`"That's Great" Count: ${ep.thatsGreatCount}`);
      }

      return parts.join('\n');
    })
    .join('\n\n');
}

export async function synthesizeHybridAnswer(
  question: string,
  classification: ClassificationResult,
  transcriptChunks: TranscriptChunk[],
  metadataEpisodes: EpisodeMetadata[]
): Promise<string> {
  const hasTranscripts = transcriptChunks.length > 0;
  const hasMetadata = metadataEpisodes.length > 0;

  if (!hasTranscripts && !hasMetadata) {
    return 'No relevant information found. Please try a different query.';
  }

  let contextSection = '';
  let sourceDescription = '';

  if (classification.type === 'factual' && hasMetadata) {
    sourceDescription = 'episode metadata (structured data about episodes)';
    contextSection = `EPISODE METADATA:
${formatMetadataContext(metadataEpisodes)}`;
  } else if (classification.type === 'interpretive' && hasTranscripts) {
    sourceDescription = 'podcast transcripts (what was actually said)';
    contextSection = `PODCAST TRANSCRIPTS:
${formatTranscriptContext(transcriptChunks)}`;
  } else if (classification.type === 'hybrid') {
    sourceDescription = 'both episode metadata AND podcast transcripts';
    const parts: string[] = [];

    if (hasMetadata) {
      parts.push(`EPISODE METADATA (${metadataEpisodes.length} episodes):
${formatMetadataContext(metadataEpisodes)}`);
    }

    if (hasTranscripts) {
      parts.push(`PODCAST TRANSCRIPTS (${transcriptChunks.length} excerpts):
${formatTranscriptContext(transcriptChunks)}`);
    }

    contextSection = parts.join('\n\n---\n\n');
  }

  const systemPrompt = buildSystemPrompt(classification.type, sourceDescription);

  const message = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `${systemPrompt}

${contextSection}

QUESTION: ${question}

Provide a thoughtful answer based on the information above.`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text : 'Unable to generate a response.';
}

export interface MetadataContext {
  totalCount: number;
  returnedCount: number;
  hasMore: boolean;
}

export async function* synthesizeHybridAnswerStreaming(
  question: string,
  classification: ClassificationResult,
  transcriptChunks: TranscriptChunk[],
  metadataEpisodes: EpisodeMetadata[],
  metadataContext?: MetadataContext
): AsyncGenerator<{ type: 'chunk' | 'done'; text: string }> {
  const hasTranscripts = transcriptChunks.length > 0;
  const hasMetadata = metadataEpisodes.length > 0;

  if (!hasTranscripts && !hasMetadata) {
    yield { type: 'done', text: 'No relevant information found. Please try a different query.' };
    return;
  }

  let contextSection = '';
  let sourceDescription = '';
  let truncationNote = '';

  // Add truncation note if results were limited
  if (metadataContext?.hasMore) {
    truncationNote = `\n\nNOTE: Showing ${metadataContext.returnedCount} of ${metadataContext.totalCount} total matching episodes. The response includes the most recent episodes.`;
  }

  if (classification.type === 'factual' && hasMetadata) {
    sourceDescription = 'episode metadata (structured data about episodes)';
    const countInfo = metadataContext
      ? ` (${metadataContext.returnedCount}${metadataContext.hasMore ? ` of ${metadataContext.totalCount}` : ''} episodes)`
      : '';
    contextSection = `EPISODE METADATA${countInfo}:
${formatMetadataContext(metadataEpisodes)}${truncationNote}`;
  } else if (classification.type === 'interpretive' && hasTranscripts) {
    sourceDescription = 'podcast transcripts (what was actually said)';
    contextSection = `PODCAST TRANSCRIPTS:
${formatTranscriptContext(transcriptChunks)}`;
  } else if (classification.type === 'hybrid') {
    sourceDescription = 'both episode metadata AND podcast transcripts';
    const parts: string[] = [];

    if (hasMetadata) {
      const countInfo = metadataContext
        ? `${metadataContext.returnedCount}${metadataContext.hasMore ? ` of ${metadataContext.totalCount}` : ''}`
        : String(metadataEpisodes.length);
      parts.push(`EPISODE METADATA (${countInfo} episodes):
${formatMetadataContext(metadataEpisodes)}${truncationNote}`);
    }

    if (hasTranscripts) {
      parts.push(`PODCAST TRANSCRIPTS (${transcriptChunks.length} excerpts):
${formatTranscriptContext(transcriptChunks)}`);
    }

    contextSection = parts.join('\n\n---\n\n');
  }

  const systemPrompt = buildSystemPrompt(classification.type, sourceDescription);

  const stream = getAnthropic().messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,  // Increased for longer lists
    messages: [
      {
        role: 'user',
        content: `${systemPrompt}

${contextSection}

QUESTION: ${question}

Provide a thoughtful answer based on the information above.`,
      },
    ],
  });

  let fullText = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      yield { type: 'chunk', text: event.delta.text };
    }
  }

  yield { type: 'done', text: fullText };
}

function buildSystemPrompt(
  queryType: 'factual' | 'interpretive' | 'hybrid',
  sourceDescription: string
): string {
  const basePrompt = `You are a helpful assistant that answers questions about the Escape Hatch podcast. You have access to ${sourceDescription}.

Always refer to "Matt Haitch" or "Haitch Matt" as just "Haitch".

IMPORTANT: Format your response using proper Markdown:
- Use ## for section headings (e.g., "## Overview")
- Use **bold** for emphasis and film titles
- Use bullet points for lists
- Use > for direct quotes`;

  switch (queryType) {
    case 'factual':
      return `${basePrompt}

This is a FACTUAL query about episode metadata. Provide:
- Direct, concise answers with specific counts or lists
- Reference specific episodes by name, season, and episode number
- If counting, show your work by listing the items counted
- Format lists clearly with bullet points or numbered items
- Use ## headings to organize by year or category if listing many items`;

    case 'interpretive':
      return `${basePrompt}

This is an INTERPRETIVE query about opinions and discussions. Provide:
- Analytical synthesis of what the hosts said and thought
- Include direct quotes with episode names and timestamps
- Capture nuance and different perspectives between hosts
- Don't just list quotes - weave them into a coherent narrative
- Use ## headings to organize themes or topics in your analysis`;

    case 'hybrid':
      return `${basePrompt}

This is a HYBRID query that requires both metadata filtering AND content analysis. Provide:
- First, identify relevant episodes based on the metadata criteria
- Then, analyze what was said in those specific episodes
- Combine factual information (which episodes, who, when) with interpretive analysis (what they thought, how they felt)
- Reference both episode metadata and specific quotes where helpful
- Use ## headings to organize your response`;
  }
}
