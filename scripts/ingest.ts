import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { list } from '@vercel/blob';

// Load environment variables
dotenv.config({ path: '.env.local' });

// ============================================
// BM25 Implementation (inlined to avoid import issues)
// ============================================

interface BM25Document {
  id: string;
  text: string;
  metadata: {
    episodeTitle: string;
    speakers: string;
    startTimestamp: string;
    endTimestamp: string;
  };
}

interface BM25Index {
  df: Record<string, number>;
  invertedIndex: Record<string, [number, number][]>;
  docLengths: number[];
  avgDocLength: number;
  numDocs: number;
  docIds: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function buildBM25Index(documents: BM25Document[]): BM25Index {
  const df: Record<string, number> = {};
  const invertedIndex: Record<string, [number, number][]> = {};
  const docLengths: number[] = [];
  const docIds: string[] = [];
  let totalLength = 0;

  documents.forEach((doc, docIndex) => {
    const tokens = tokenize(doc.text);
    docLengths.push(tokens.length);
    docIds.push(doc.id);
    totalLength += tokens.length;

    const termFreqs: Record<string, number> = {};
    for (const token of tokens) {
      termFreqs[token] = (termFreqs[token] || 0) + 1;
    }

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
    avgDocLength: documents.length > 0 ? totalLength / documents.length : 0,
    numDocs: documents.length,
    docIds,
  };
}

// ============================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface DialogueEntry {
  name: string;
  timestamp: string;
  text: string;
}

interface Transcript {
  episode_number?: number;
  episode_name: string;
  dialogues: DialogueEntry[];
}

interface Chunk {
  id: string;
  text: string;
  episodeTitle: string;
  speakers: string[];
  startTimestamp: string;
  endTimestamp: string;
}

interface StoredChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    episodeTitle: string;
    speakers: string;
    startTimestamp: string;
    endTimestamp: string;
  };
}

const TRANSCRIPTS_DIR = './transcripts';
const STORE_PATH = './vector-store.json';
const BM25_STORE_PATH = './bm25-index.json';
const TARGET_CHUNK_SIZE = 500;
const OVERLAP_SIZE = 50;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function chunkTranscript(transcript: Transcript): Chunk[] {
  const chunks: Chunk[] = [];
  const dialogues = transcript.dialogues;

  if (!dialogues || dialogues.length === 0) return chunks;

  let currentChunk: DialogueEntry[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (let i = 0; i < dialogues.length; i++) {
    const entry = dialogues[i];
    const entryTokens = estimateTokens(`${entry.name}: ${entry.text}`);

    if (currentTokens + entryTokens > TARGET_CHUNK_SIZE * 4 && currentChunk.length > 0) {
      const chunkText = currentChunk
        .map((e) => `[${e.timestamp}] ${e.name}: ${e.text}`)
        .join('\n');
      const speakers = [...new Set(currentChunk.map((e) => e.name))];

      chunks.push({
        id: `${transcript.episode_name.replace(/[^a-zA-Z0-9]/g, '_')}_${chunkIndex}`,
        text: chunkText,
        episodeTitle: transcript.episode_name,
        speakers,
        startTimestamp: currentChunk[0].timestamp,
        endTimestamp: currentChunk[currentChunk.length - 1].timestamp,
      });

      chunkIndex++;

      const overlapEntries: DialogueEntry[] = [];
      let overlapTokens = 0;
      for (let j = currentChunk.length - 1; j >= 0 && overlapTokens < OVERLAP_SIZE * 4; j--) {
        overlapEntries.unshift(currentChunk[j]);
        overlapTokens += estimateTokens(`${currentChunk[j].name}: ${currentChunk[j].text}`);
      }
      currentChunk = overlapEntries;
      currentTokens = overlapTokens;
    }

    currentChunk.push(entry);
    currentTokens += entryTokens;
  }

  if (currentChunk.length > 0) {
    const chunkText = currentChunk
      .map((e) => `[${e.timestamp}] ${e.name}: ${e.text}`)
      .join('\n');
    const speakers = [...new Set(currentChunk.map((e) => e.name))];

    chunks.push({
      id: `${transcript.episode_name.replace(/[^a-zA-Z0-9]/g, '_')}_${chunkIndex}`,
      text: chunkText,
      episodeTitle: transcript.episode_name,
      speakers,
      startTimestamp: currentChunk[0].timestamp,
      endTimestamp: currentChunk[currentChunk.length - 1].timestamp,
    });
  }

  return chunks;
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const batchSize = 100;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    console.log(`  Generating embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}...`);
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });
    embeddings.push(...response.data.map((d) => d.embedding));
  }

  return embeddings;
}

async function loadBlobTranscripts(): Promise<{ name: string; transcript: Transcript }[]> {
  const results: { name: string; transcript: Transcript }[] = [];

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log('BLOB_READ_WRITE_TOKEN not set, skipping Blob storage');
    return results;
  }

  try {
    const blobs = await list({ prefix: 'transcripts/' });

    for (const blob of blobs.blobs) {
      if (blob.pathname.endsWith('.json')) {
        try {
          const response = await fetch(blob.url);
          if (response.ok) {
            const transcript: Transcript = await response.json();
            results.push({
              name: blob.pathname.replace('transcripts/', ''),
              transcript,
            });
          }
        } catch (err) {
          console.warn(`  Warning: Could not load ${blob.pathname}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn('Warning: Could not access Blob storage:', err);
  }

  return results;
}

async function main() {
  console.log('Starting transcript ingestion...\n');

  const allChunks: Chunk[] = [];
  const seenEpisodes = new Set<string>();

  // Load from filesystem first
  if (fs.existsSync(TRANSCRIPTS_DIR)) {
    const files = fs.readdirSync(TRANSCRIPTS_DIR).filter((f) => f.endsWith('.json'));
    console.log(`Found ${files.length} transcript file(s) in filesystem.\n`);

    for (const file of files) {
      const filePath = path.join(TRANSCRIPTS_DIR, file);
      console.log(`Processing: ${file}`);

      const content = fs.readFileSync(filePath, 'utf-8');
      const transcript: Transcript = JSON.parse(content);

      seenEpisodes.add(transcript.episode_name);

      const chunks = chunkTranscript(transcript);
      allChunks.push(...chunks);
      console.log(`  Created ${chunks.length} chunks from ${transcript.dialogues?.length || 0} dialogue entries.`);
    }
  } else {
    console.log(`${TRANSCRIPTS_DIR} directory not found, will try Blob storage.\n`);
  }

  // Load from Blob storage (for transcripts not in filesystem)
  console.log('\nChecking Blob storage for additional transcripts...');
  const blobTranscripts = await loadBlobTranscripts();

  let blobCount = 0;
  for (const { name, transcript } of blobTranscripts) {
    // Skip if we already have this episode from filesystem
    if (seenEpisodes.has(transcript.episode_name)) {
      console.log(`  Skipping ${name} (already loaded from filesystem)`);
      continue;
    }

    console.log(`Processing from Blob: ${name}`);
    const chunks = chunkTranscript(transcript);
    allChunks.push(...chunks);
    console.log(`  Created ${chunks.length} chunks from ${transcript.dialogues?.length || 0} dialogue entries.`);
    blobCount++;
  }

  if (blobCount > 0) {
    console.log(`\nLoaded ${blobCount} additional transcript(s) from Blob storage.`);
  } else {
    console.log('No additional transcripts found in Blob storage.');
  }

  if (allChunks.length === 0) {
    console.error('\nNo transcripts found in filesystem or Blob storage.');
    process.exit(1);
  }

  console.log(`\nTotal chunks to index: ${allChunks.length}`);

  console.log('\nGenerating embeddings...');
  const embeddings = await generateEmbeddings(allChunks.map((c) => c.text));

  console.log('\nSaving vector store...');
  const storedChunks: StoredChunk[] = allChunks.map((chunk, i) => ({
    id: chunk.id,
    text: chunk.text,
    embedding: embeddings[i],
    metadata: {
      episodeTitle: chunk.episodeTitle,
      speakers: chunk.speakers.join(', '),
      startTimestamp: chunk.startTimestamp,
      endTimestamp: chunk.endTimestamp,
    },
  }));

  fs.writeFileSync(STORE_PATH, JSON.stringify({ chunks: storedChunks }));

  // Build BM25 index for lexical search
  console.log('\nBuilding BM25 lexical index...');
  const bm25Documents: BM25Document[] = storedChunks.map((chunk) => ({
    id: chunk.id,
    text: chunk.text,
    metadata: chunk.metadata,
  }));

  const bm25Index = buildBM25Index(bm25Documents);
  fs.writeFileSync(BM25_STORE_PATH, JSON.stringify(bm25Index));

  console.log(`  BM25 index: ${Object.keys(bm25Index.invertedIndex).length} unique terms`);
  console.log(`  BM25 index saved to ${BM25_STORE_PATH}`);

  console.log('\n✓ Ingestion complete!');
  console.log(`  Indexed ${allChunks.length} chunks from ${seenEpisodes.size} transcript(s).`);
  console.log(`  Vector store saved to ${STORE_PATH}`);
  console.log(`  BM25 index saved to ${BM25_STORE_PATH}`);
}

main().catch(console.error);
