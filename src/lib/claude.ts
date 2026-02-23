import Anthropic from '@anthropic-ai/sdk';
import { TranscriptChunk } from '@/types/transcript';
import {
  EpisodeMetadata,
  ClassificationResult,
} from '@/types/episode-metadata';
import { formatEpisodeDescriptor } from './episode-format';

/**
 * Normalize speaker names before they reach synthesis prompts.
 * "Matt Haitch" / "Haitch Matt" → "Haitch" so the LLM never sees the confusing full label.
 */
function normalizeSpeakers(speakers: string[]): string[] {
  return speakers.map((s) => {
    const lower = s.toLowerCase().trim();
    if (lower === 'matt haitch' || lower === 'haitch matt') return 'Haitch';
    return s;
  });
}

export const HOST_IDENTITY_RULE = `HOST IDENTITY RULE (MANDATORY):
- The Escape Hatch podcast has exactly TWO hosts: "Haitch" and "Jason". Every episode features both of them.
- "Matt", "Matt Haitch", and "Haitch" are ALL the same person — use "Haitch" only.
- All other named speakers (e.g., Proto, Slim, Corey, Kev, Jonesy, Rosie, birria, Hex, Nexus9, Truthsayer, etc.) are guests, featured reviewers, or voicemailers — NEVER refer to them as hosts.
- When the user says "the hosts", they mean Haitch and Jason exclusively.`;

let anthropicClient: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 4,
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
Speakers: ${normalizeSpeakers(chunk.speakers).join(', ')}
Timestamp: ${chunk.startTimestamp} - ${chunk.endTimestamp}
---
${chunk.text}
---`;
    })
    .join('\n\n');

  const message = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,  // Increased from 1024 for longer interpretive answers
    messages: [
      {
        role: 'user',
        content: `You are a helpful assistant that answers questions about the Escape Hatch podcast. Based on the following podcast excerpts, answer the question thoughtfully.

${HOST_IDENTITY_RULE}

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
Speakers: ${normalizeSpeakers(chunk.speakers).join(', ')}
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
        formatEpisodeDescriptor(ep.season, ep.episode),
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

function computeCountSummary(
  question: string,
  episodes: EpisodeMetadata[],
  metadataContext?: MetadataContext
): string | null {
  if (metadataContext?.hasMore) {
    return null;
  }

  const normalized = question.toLowerCase();
  const wantsCount = /(how many|what .*movies|which .*movies|what .*films|which .*films|what .*episodes|which .*episodes)/.test(normalized);
  if (!wantsCount) {
    return null;
  }

  const uniqueFilms = new Set(episodes.map((ep) => ep.film)).size;
  const episodeCount = episodes.length;
  return `COUNT_SUMMARY: ${uniqueFilms} films across ${episodeCount} episodes.`;
}

export async function synthesizeHybridAnswer(
  question: string,
  classification: ClassificationResult,
  transcriptChunks: TranscriptChunk[],
  metadataEpisodes: EpisodeMetadata[],
  metadataContext?: MetadataContext,
  tuning?: { model?: string; maxTokens?: number }
): Promise<string> {
  const hasTranscripts = transcriptChunks.length > 0;
  const hasMetadata = metadataEpisodes.length > 0;

  if (!hasTranscripts && !hasMetadata) {
    return 'No matching episodes found in the database.\n\n**Note:** The episode database can filter by: film title, decade (e.g., "80s movies"), season number, guest name, reviewer, director, cinematographer, actor, or genre.';
  }

  let contextSection = '';
  let sourceDescription = '';
  let truncationNote = '';

  // Add truncation note if results were limited
  if (metadataContext?.hasMore) {
    truncationNote = `\n\nNOTE: Showing ${metadataContext.returnedCount} of ${metadataContext.totalCount} total matching episodes. The response includes the most recent episodes.`;
  }

  const countSummary = classification.type === 'factual' && hasMetadata
    ? computeCountSummary(question, metadataEpisodes, metadataContext)
    : null;

  if (classification.type === 'factual' && hasMetadata && !hasTranscripts) {
    sourceDescription = 'episode metadata (structured data about episodes)';
    const countInfo = metadataContext
      ? ` (${metadataContext.returnedCount}${metadataContext.hasMore ? ` of ${metadataContext.totalCount}` : ''} episodes)`
      : '';
    contextSection = `EPISODE METADATA${countInfo}:
${formatMetadataContext(metadataEpisodes)}${truncationNote}${countSummary ? `\n\n${countSummary}` : ''}`;
  } else if (classification.type === 'factual' && hasMetadata && hasTranscripts) {
    // Factual query with both sources — metadata is primary, transcripts supplement
    sourceDescription = 'episode metadata AND podcast transcripts';
    const countInfo = metadataContext
      ? ` (${metadataContext.returnedCount}${metadataContext.hasMore ? ` of ${metadataContext.totalCount}` : ''} episodes)`
      : '';
    contextSection = `EPISODE METADATA${countInfo}:
${formatMetadataContext(metadataEpisodes)}${truncationNote}${countSummary ? `\n\n${countSummary}` : ''}

---

PODCAST TRANSCRIPTS (${transcriptChunks.length} supplementary excerpts):
${formatTranscriptContext(transcriptChunks)}`;
  } else if (classification.type === 'factual' && !hasMetadata && hasTranscripts) {
    // Factual query fell back to transcripts (no metadata matched)
    sourceDescription = 'podcast transcripts (searched because no structured metadata matched your query)';
    contextSection = `PODCAST TRANSCRIPTS (${transcriptChunks.length} excerpts):
${formatTranscriptContext(transcriptChunks)}

NOTE: No structured episode metadata matched this query. The transcripts above may contain relevant discussion.`;
  } else if (hasTranscripts && !hasMetadata) {
    sourceDescription = 'podcast transcripts (what was actually said)';
    contextSection = `PODCAST TRANSCRIPTS:
${formatTranscriptContext(transcriptChunks)}`;
  } else {
    // Both sources available (hybrid, or interpretive with metadata)
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

  const systemPrompt = buildSystemPrompt(classification.type, sourceDescription, Boolean(countSummary));
  const maxTokens = tuning?.maxTokens ?? getAdaptiveMaxTokens(classification.type, metadataEpisodes.length);
  const model = tuning?.model ?? 'claude-sonnet-4-20250514';

  const message = await getAnthropic().messages.create({
    model,
    max_tokens: maxTokens,
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

/**
 * Calculate adaptive max_tokens based on query type and result count.
 * - Factual queries need more tokens to list episodes
 * - More results = more tokens needed
 * - Hybrid queries need room for both metadata and analysis
 */
function getAdaptiveMaxTokens(
  queryType: 'factual' | 'interpretive' | 'hybrid',
  metadataCount: number
): number {
  // Base tokens for interpretive analysis
  let tokens = 1024;

  // Factual queries need room for episode lists
  if (queryType === 'factual') {
    tokens += 1024;
    // Large result sets need even more
    if (metadataCount > 20) {
      tokens += 1024;
    } else if (metadataCount > 10) {
      tokens += 512;
    }
  }

  // Hybrid queries need both metadata summary and analysis
  if (queryType === 'hybrid') {
    tokens += 512;
    if (metadataCount > 10) {
      tokens += 512;
    }
  }

  // Cap at 4096 to avoid excessive costs
  return Math.min(tokens, 4096);
}

export async function* synthesizeHybridAnswerStreaming(
  question: string,
  classification: ClassificationResult,
  transcriptChunks: TranscriptChunk[],
  metadataEpisodes: EpisodeMetadata[],
  metadataContext?: MetadataContext,
  tuning?: { model?: string; maxTokens?: number }
): AsyncGenerator<{ type: 'chunk' | 'done'; text: string }> {
  const hasTranscripts = transcriptChunks.length > 0;
  const hasMetadata = metadataEpisodes.length > 0;

  if (!hasTranscripts && !hasMetadata) {
    yield { type: 'done', text: 'No matching episodes found in the database.\n\n**Note:** The episode database can filter by: film title, decade (e.g., "80s movies"), season number, guest name, reviewer, director, cinematographer, actor, or genre.' };
    return;
  }

  let contextSection = '';
  let sourceDescription = '';
  let truncationNote = '';

  // Add truncation note if results were limited
  if (metadataContext?.hasMore) {
    truncationNote = `\n\nNOTE: Showing ${metadataContext.returnedCount} of ${metadataContext.totalCount} total matching episodes. The response includes the most recent episodes.`;
  }

  const countSummary = classification.type === 'factual' && hasMetadata
    ? computeCountSummary(question, metadataEpisodes, metadataContext)
    : null;

  if (classification.type === 'factual' && hasMetadata && !hasTranscripts) {
    sourceDescription = 'episode metadata (structured data about episodes)';
    const countInfo = metadataContext
      ? ` (${metadataContext.returnedCount}${metadataContext.hasMore ? ` of ${metadataContext.totalCount}` : ''} episodes)`
      : '';
    contextSection = `EPISODE METADATA${countInfo}:
${formatMetadataContext(metadataEpisodes)}${truncationNote}${countSummary ? `\n\n${countSummary}` : ''}`;
  } else if (classification.type === 'factual' && hasMetadata && hasTranscripts) {
    sourceDescription = 'episode metadata AND podcast transcripts';
    const countInfo = metadataContext
      ? ` (${metadataContext.returnedCount}${metadataContext.hasMore ? ` of ${metadataContext.totalCount}` : ''} episodes)`
      : '';
    contextSection = `EPISODE METADATA${countInfo}:
${formatMetadataContext(metadataEpisodes)}${truncationNote}${countSummary ? `\n\n${countSummary}` : ''}

---

PODCAST TRANSCRIPTS (${transcriptChunks.length} supplementary excerpts):
${formatTranscriptContext(transcriptChunks)}`;
  } else if (classification.type === 'factual' && !hasMetadata && hasTranscripts) {
    sourceDescription = 'podcast transcripts (searched because no structured metadata matched your query)';
    contextSection = `PODCAST TRANSCRIPTS (${transcriptChunks.length} excerpts):
${formatTranscriptContext(transcriptChunks)}

NOTE: No structured episode metadata matched this query. The transcripts above may contain relevant discussion.`;
  } else if (hasTranscripts && !hasMetadata) {
    sourceDescription = 'podcast transcripts (what was actually said)';
    contextSection = `PODCAST TRANSCRIPTS:
${formatTranscriptContext(transcriptChunks)}`;
  } else {
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

  const systemPrompt = buildSystemPrompt(classification.type, sourceDescription, Boolean(countSummary));
  const maxTokens = tuning?.maxTokens ?? getAdaptiveMaxTokens(classification.type, metadataEpisodes.length);
  const model = tuning?.model ?? 'claude-sonnet-4-20250514';

  const stream = getAnthropic().messages.stream({
    model,
    max_tokens: maxTokens,
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
  sourceDescription: string,
  hasCountSummary: boolean
): string {
  const basePrompt = `You are a helpful assistant that answers questions about the Escape Hatch podcast. You have access to ${sourceDescription}.

${HOST_IDENTITY_RULE}

CRITICAL GROUNDING RULES - YOU MUST FOLLOW THESE:
1. ONLY reference information that explicitly appears in the provided data below
2. NEVER invent, guess, or hallucinate episodes, films, guests, or quotes
3. If the provided data does not contain relevant information, clearly state "I don't have information about [topic] in the provided data"
4. If asked about something not in the data, do NOT make up plausible-sounding answers
5. When listing episodes from METADATA, only list ones that appear in the EPISODE METADATA section
6. When using TRANSCRIPTS, you CAN extract factual information mentioned in the conversation (e.g., if hosts discuss covering a Tim Burton film, you can report that)
7. When transcript excerpts are provided, CAREFULLY search through ALL of them for the specific words, phrases, names, or content the user is asking about. Only conclude "I don't have information" after verifying the content is not present in ANY excerpt.
8. If the provided excerpts are related to the query topic but don't directly answer the question, describe what you DID find rather than just saying you don't have the information. Partial answers are better than no answer.

IMPORTANT: Format your response using proper Markdown:
- Use ## for section headings (e.g., "## Overview")
- Use **bold** for emphasis and film titles
- Use bullet points for lists
- Use "quotation marks" for inline quotes, NOT > characters
- Only use > for standalone block quotes on their own line`;

  // Check if we're using transcripts as a fallback for factual queries
  const isTranscriptFallback = sourceDescription.includes('transcript') && queryType === 'factual';

  switch (queryType) {
    case 'factual':
      if (isTranscriptFallback) {
        return `${basePrompt}

This is a FACTUAL query, but no structured metadata matched. Using transcript search instead.
- Extract factual information from the transcript excerpts (e.g., which films were discussed, who was mentioned)
- If the hosts mention covering specific films or directors, report those findings
- Be clear that the information comes from transcript discussion, not structured episode data
- If the transcripts don't contain relevant information, clearly state that`;
      }
      return `${basePrompt}

This is a FACTUAL query about episode metadata. Provide:
- Direct, concise answers with specific counts or lists
- Reference specific episodes by name, season, and episode number
- IMPORTANT: List ALL matching episodes - do not skip any or summarize. If 10 episodes match, list all 10.
- Format lists clearly with bullet points or numbered items
- Use ## headings to organize by year or category if listing many items
- If a COUNT_SUMMARY is provided, use it and do not restate or invent other counts
- Verify your count matches the number of items you listed when you include counts
- If no episodes match the criteria, clearly state that (e.g., "No Tim Burton films appear in the episode data")`;

    case 'interpretive':
      return `${basePrompt}

This is an INTERPRETIVE query about opinions and discussions. Provide:
- Analytical synthesis of what the hosts said and thought
- Include direct quotes with episode names and timestamps
- Capture nuance and different perspectives between hosts
- Don't just list quotes - weave them into a coherent narrative
- Use ## headings to organize themes or topics in your analysis
- If the transcripts don't discuss the topic, clearly state that`;

    case 'hybrid':
      return `${basePrompt}

This is a HYBRID query that requires both metadata filtering AND content analysis. Provide:
- First, identify relevant episodes based on the metadata criteria
- Then, analyze what was said in those specific episodes
- Combine factual information (which episodes, who, when) with interpretive analysis (what they thought, how they felt)
- Reference both episode metadata and specific quotes where helpful
- Use ## headings to organize your response
- If no relevant data is found, clearly state that`;
  }
}
