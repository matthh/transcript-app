import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { list, put } from '@vercel/blob';

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
const SEARCH_DATA_PREFIX = 'search-data/';
const MANIFEST_PATH = `${SEARCH_DATA_PREFIX}ingest-manifest.json`;
const TARGET_CHUNK_SIZE = 500;
const OVERLAP_SIZE = 50;
const SKIP_IF_NO_NEW = process.env.SKIP_INGEST_IF_NO_NEW === '1'
  || process.env.SKIP_INGEST_IF_NO_NEW === 'true';

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

// ============================================
// Personal-aside sub-chunking
// ============================================

const HOST_NAMES_LOWER = [
  'matt haitch', 'jason goldman', 'jason', 'haitch',
  'matt', 'haitch matt', 'mattie',
];

function isHostSpeaker(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return HOST_NAMES_LOWER.some((h) => lower.includes(h));
}

interface AsideCategory {
  name: string;
  preferenceMarkers: RegExp[];
  topicNouns: RegExp[];
  minPreferenceMarkers: number;
  minTopicNouns: number;
}

const ASIDE_CATEGORIES: AsideCategory[] = [
  {
    name: 'food-preference',
    preferenceMarkers: [
      // Food-specific preference language (avoid generic "i love", "my favorite")
      /the answer is/i, /really delicious/i, /comfort food/i,
      /i would .{0,20}(eat|have|get|order)/i, /guilty pleasure/i,
      /i('m| am) hungry/i, /food focused/i,
      /late night snack/i, /looking for is/i,
      /favorite (food|snack|meal|dish|restaurant)/i,
    ],
    topicNouns: [
      // Specific food items unlikely to appear in movie discussion
      /velveeta/i, /shells and cheese/i, /burrito/i, /bbq/i,
      /barbecue/i, /bagel/i, /\blox\b/i, /babka/i, /rice pudding/i,
      /salt lick/i, /\bsnack/i, /fried chicken/i,
      /ramen/i, /sushi/i, /mac and cheese/i, /ice cream/i,
      /cozy shack/i, /prepared food/i, /pickle/i,
      /brisket/i, /chihuahua/i,
      // The word "food(s)" itself is a strong signal
      /\bfoods?\b/i,
    ],
    minPreferenceMarkers: 1,
    minTopicNouns: 2,
  },
];

const ASIDE_WINDOW_SIZE = 15;
const ASIDE_MAX_TOKENS = 400;
const ASIDE_CHUNK_ID_OFFSET = 1000;

function extractPersonalAsides(transcript: Transcript): Chunk[] {
  const dialogues = transcript.dialogues;
  if (!dialogues || dialogues.length < 3) return [];

  const asides: Chunk[] = [];
  const coveredRanges: [number, number][] = [];
  let asideIndex = 0;

  for (const category of ASIDE_CATEGORIES) {
    for (let windowStart = 0; windowStart <= dialogues.length - 3; windowStart++) {
      const windowEnd = Math.min(windowStart + ASIDE_WINDOW_SIZE, dialogues.length);
      const window = dialogues.slice(windowStart, windowEnd);

      // Check if window overlaps with an already-extracted aside
      if (coveredRanges.some(([s, e]) => windowStart < e && windowEnd > s)) continue;

      // Check for host speaker
      const hasHost = window.some((d) => isHostSpeaker(d.name));
      if (!hasHost) continue;

      // Count preference markers across window text
      const windowText = window.map((d) => d.text).join(' ');
      let prefCount = 0;
      for (const pat of category.preferenceMarkers) {
        if (pat.test(windowText)) prefCount++;
      }
      if (prefCount < category.minPreferenceMarkers) continue;

      // Count topic nouns
      let nounCount = 0;
      for (const pat of category.topicNouns) {
        if (pat.test(windowText)) nounCount++;
      }
      if (nounCount < category.minTopicNouns) continue;

      // Find the tightest relevant range within the window
      const range = findRelevantRange(window, category, windowStart);
      if (!range) continue;

      const [relStart, relEnd] = range;
      const absStart = windowStart + relStart;
      const absEnd = windowStart + relEnd;

      // Check overlap again with absolute range
      if (coveredRanges.some(([s, e]) => absStart < e && absEnd > s)) continue;

      // Extract dialogue turns with 1-turn context padding
      const padStart = Math.max(0, absStart - 1);
      const padEnd = Math.min(dialogues.length, absEnd + 1);
      const asideDialogues = dialogues.slice(padStart, padEnd);

      // Cap at max tokens
      let text = '';
      const usedDialogues: DialogueEntry[] = [];
      for (const d of asideDialogues) {
        const line = `[${d.timestamp}] ${d.name}: ${d.text}`;
        if (estimateTokens(text + '\n' + line) > ASIDE_MAX_TOKENS && usedDialogues.length > 0) break;
        usedDialogues.push(d);
        text = text ? text + '\n' + line : line;
      }

      if (usedDialogues.length < 2) continue;

      const speakers = [...new Set(usedDialogues.map((d) => d.name))];
      const sanitizedName = transcript.episode_name.replace(/[^a-zA-Z0-9]/g, '_');
      const chunkId = `${sanitizedName}_${ASIDE_CHUNK_ID_OFFSET + asideIndex}`;

      asides.push({
        id: chunkId,
        text,
        episodeTitle: transcript.episode_name,
        speakers,
        startTimestamp: usedDialogues[0].timestamp,
        endTimestamp: usedDialogues[usedDialogues.length - 1].timestamp,
      });

      coveredRanges.push([absStart, absEnd]);
      asideIndex++;
    }
  }

  return asides;
}

function findRelevantRange(
  window: DialogueEntry[],
  category: AsideCategory,
  _windowStart: number,
): [number, number] | null {
  // Score each dialogue turn for relevance
  const scores: number[] = window.map((d) => {
    let score = 0;
    for (const pat of category.preferenceMarkers) {
      if (pat.test(d.text)) score += 2;
    }
    for (const pat of category.topicNouns) {
      if (pat.test(d.text)) score += 1;
    }
    return score;
  });

  // Find first and last relevant turn (score > 0)
  let first = -1;
  let last = -1;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > 0) {
      if (first === -1) first = i;
      last = i;
    }
  }

  if (first === -1) return null;

  // Return [first, last+1) as a half-open range
  return [first, last + 1];
}

// ============================================
// Catchphrase sub-chunking
// ============================================

/**
 * Known recurring catchphrases to extract as sub-chunks.
 * Each entry maps a phrase pattern to its canonical form and speaker.
 */
const CATCHPHRASE_PATTERNS: { pattern: RegExp; speaker: string; label: string }[] = [
  { pattern: /you hack/i, speaker: 'Jason Goldman', label: 'you hack' },
];

const CATCHPHRASE_CHUNK_ID_OFFSET = 2000;

/**
 * Extract small sub-chunks around known recurring catchphrases.
 * For each occurrence, creates a 3-turn window (line before, the line, line after)
 * to give embedding context while keeping the chunk focused on the catchphrase usage.
 */
function extractCatchphraseChunks(transcript: Transcript): Chunk[] {
  const dialogues = transcript.dialogues;
  if (!dialogues || dialogues.length === 0) return [];

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const cp of CATCHPHRASE_PATTERNS) {
    for (let i = 0; i < dialogues.length; i++) {
      if (!cp.pattern.test(dialogues[i].text)) continue;

      // 3-turn window: one before, the line, one after
      const start = Math.max(0, i - 1);
      const end = Math.min(dialogues.length, i + 2);
      const window = dialogues.slice(start, end);

      const dialogueText = window
        .map((d) => `[${d.timestamp}] ${d.name}: ${d.text}`)
        .join('\n');
      // Prefix with semantic context so embedding matches "catchphrase" queries
      const text = `[Recurring catchphrase: "${cp.label}" — ${cp.speaker}]\n${dialogueText}`;

      const speakers = [...new Set(window.map((d) => d.name))];
      const sanitizedName = transcript.episode_name.replace(/[^a-zA-Z0-9]/g, '_');
      const chunkId = `${sanitizedName}_${CATCHPHRASE_CHUNK_ID_OFFSET + chunkIndex}`;

      chunks.push({
        id: chunkId,
        text,
        episodeTitle: transcript.episode_name,
        speakers,
        startTimestamp: window[0].timestamp,
        endTimestamp: window[window.length - 1].timestamp,
      });

      chunkIndex++;
    }
  }

  return chunks;
}

// ============================================

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const batchSize = 100;
  const maxRetries = 5;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(texts.length / batchSize);
    console.log(`  Generating embeddings for batch ${batchNum}/${totalBatches}...`);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: batch,
        });
        embeddings.push(...response.data.map((d) => d.embedding));
        break;
      } catch (err: unknown) {
        const isRateLimit = err instanceof Error && 'status' in err && (err as { status: number }).status === 429;
        if (isRateLimit && attempt < maxRetries - 1) {
          const backoff = Math.pow(2, attempt + 1) * 1000;
          console.log(`  Rate limited, retrying in ${backoff / 1000}s (attempt ${attempt + 2}/${maxRetries})...`);
          await new Promise((r) => setTimeout(r, backoff));
        } else {
          throw err;
        }
      }
    }
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

function hashObject(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function getLocalTranscriptFingerprint(): { hash: string; count: number } {
  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    return { hash: hashObject([]), count: 0 };
  }

  const entries = fs.readdirSync(TRANSCRIPTS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const filePath = path.join(TRANSCRIPTS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        file,
        size: Buffer.byteLength(content, 'utf-8'),
        contentHash: hashObject(content),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));

  return { hash: hashObject(entries), count: entries.length };
}

async function getBlobTranscriptFingerprint(): Promise<{ hash: string; count: number }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { hash: hashObject([]), count: 0 };
  }

  try {
    const blobs = await list({ prefix: 'transcripts/' });
    const entries = blobs.blobs
      .filter((blob) => blob.pathname.endsWith('.json'))
      .map((blob) => ({
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
      }))
      .sort((a, b) => a.pathname.localeCompare(b.pathname));

    return { hash: hashObject(entries), count: entries.length };
  } catch (err) {
    console.warn('Warning: Could not list transcript blobs for fingerprinting:', err);
    return { hash: hashObject([]), count: 0 };
  }
}

async function loadRemoteManifest(): Promise<{ hash: string } | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return null;
  }

  try {
    const blobs = await list({ prefix: MANIFEST_PATH });
    const match = blobs.blobs.find((b) => b.pathname === MANIFEST_PATH);
    if (!match) {
      return null;
    }
    const response = await fetch(match.url);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (err) {
    console.warn('Warning: Could not load ingest manifest from Blob:', err);
    return null;
  }
}

async function saveRemoteManifest(payload: {
  hash: string;
  localCount: number;
  blobCount: number;
  updatedAt: string;
}): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log('BLOB_READ_WRITE_TOKEN not set, skipping manifest upload');
    return;
  }

  await put(MANIFEST_PATH, JSON.stringify(payload), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function main() {
  console.log('Starting transcript ingestion...\n');

  if (SKIP_IF_NO_NEW) {
    const localFingerprint = getLocalTranscriptFingerprint();
    const blobFingerprint = await getBlobTranscriptFingerprint();
    const combinedHash = hashObject({
      local: localFingerprint.hash,
      blob: blobFingerprint.hash,
    });
    const manifest = await loadRemoteManifest();

    if (manifest?.hash === combinedHash) {
      console.log('No transcript changes detected. Skipping embeddings.');
      return;
    }
  }

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
      const asides = extractPersonalAsides(transcript);
      const catchphrases = extractCatchphraseChunks(transcript);
      allChunks.push(...chunks, ...asides, ...catchphrases);
      const subMsg = (asides.length + catchphrases.length) > 0
        ? ` + ${asides.length} aside(s) + ${catchphrases.length} catchphrase(s)` : '';
      console.log(`  Created ${chunks.length} chunks${subMsg} from ${transcript.dialogues?.length || 0} dialogue entries.`);
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
    const asides = extractPersonalAsides(transcript);
    const catchphrases = extractCatchphraseChunks(transcript);
    allChunks.push(...chunks, ...asides, ...catchphrases);
    const subMsg = (asides.length + catchphrases.length) > 0
      ? ` + ${asides.length} aside(s) + ${catchphrases.length} catchphrase(s)` : '';
    console.log(`  Created ${chunks.length} chunks${subMsg} from ${transcript.dialogues?.length || 0} dialogue entries.`);
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

  if (SKIP_IF_NO_NEW) {
    const localFingerprint = getLocalTranscriptFingerprint();
    const blobFingerprint = await getBlobTranscriptFingerprint();
    const combinedHash = hashObject({
      local: localFingerprint.hash,
      blob: blobFingerprint.hash,
    });
    await saveRemoteManifest({
      hash: combinedHash,
      localCount: localFingerprint.count,
      blobCount: blobFingerprint.count,
      updatedAt: new Date().toISOString(),
    });
    console.log('Updated ingest manifest in Blob storage.');
  }
}

async function dryRunAsides() {
  console.log('Dry-run: scanning transcripts for personal asides...\n');

  let totalAsides = 0;
  const allResults: { episode: string; asides: Chunk[] }[] = [];

  if (fs.existsSync(TRANSCRIPTS_DIR)) {
    const files = fs.readdirSync(TRANSCRIPTS_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(TRANSCRIPTS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const transcript: Transcript = JSON.parse(content);
      const asides = extractPersonalAsides(transcript);
      if (asides.length > 0) {
        allResults.push({ episode: transcript.episode_name, asides });
        totalAsides += asides.length;
      }
    }
  }

  console.log(`Found ${totalAsides} aside(s) across ${allResults.length} episode(s):\n`);
  for (const { episode, asides } of allResults) {
    for (const aside of asides) {
      console.log(`  [${episode}] ${aside.id}`);
      console.log(`    Timestamps: ${aside.startTimestamp} - ${aside.endTimestamp}`);
      console.log(`    Speakers: ${aside.speakers.join(', ')}`);
      console.log(`    Tokens: ~${estimateTokens(aside.text)}`);
      console.log(`    Preview: ${aside.text.substring(0, 150).replace(/\n/g, ' ')}...`);
      console.log();
    }
  }
}

if (process.argv.includes('--dry-run-asides')) {
  dryRunAsides().catch(console.error);
} else {
  main().catch(console.error);
}
