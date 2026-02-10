/**
 * Synthetic eval query generator.
 *
 * Reads local transcript files and episode metadata to generate eval test cases
 * with known ground-truth answers. Output can be merged into eval-dataset.json.
 *
 * Strategies:
 *   1. Pick a random transcript chunk → extract a distinctive phrase → form a query
 *   2. Pick a known guest → "what did {guest} think about {film}"
 *   3. Pick a known voicemailer name from transcript → form a voicemail query
 *   4. Pick a film from metadata → "which episode covers {film}"
 *
 * Usage:
 *   npx tsx scripts/generate-eval-queries.ts                # print to stdout
 *   npx tsx scripts/generate-eval-queries.ts --count 20     # generate 20 cases
 *   npx tsx scripts/generate-eval-queries.ts --out data/synthetic-eval.json
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DialogueEntry {
  name: string;
  timestamp: string;
  text: string;
}

interface Transcript {
  episode_number: number;
  episode_name: string;
  dialogues: DialogueEntry[];
}

interface EpisodeMetadata {
  film: string;
  season: number;
  episode: number;
  guest: string | null;
  reviewer: string;
  kevsQuestion: string;
  notableMoments: string;
  directors?: string[];
  genres?: string[];
}

interface EvalCase {
  name: string;
  query: string;
  tags: string[];
  expectSourceEpisode?: string;
  expectTextInAnswer?: string[];
  rejectTextInAnswer?: string[];
  expectClassificationType?: string[];
  expectMinTranscriptSources?: number;
  expectMinMetadataSources?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Extract distinctive multi-word phrases (3-6 words) from text. */
function extractDistinctivePhrases(text: string): string[] {
  // Split into sentences
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const phrases: string[] = [];

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    if (words.length < 4) continue;

    // Look for proper nouns or interesting multi-word segments
    for (let i = 0; i < words.length - 2; i++) {
      const segment = words.slice(i, i + Math.min(4, words.length - i));
      const phrase = segment.join(' ');

      // Skip generic phrases
      const generic = /^(the|a|an|i|we|they|you|it|this|that|so|but|and|or|um|uh|like|just|really|actually|basically|honestly)\b/i;
      if (generic.test(phrase)) continue;

      // Keep phrases with proper nouns or distinctive words
      const hasProperNoun = segment.some((w) => /^[A-Z][a-z]/.test(w));
      const hasNumber = segment.some((w) => /\d/.test(w));
      if (hasProperNoun || hasNumber) {
        phrases.push(phrase.replace(/[,;:]+$/, '').trim());
      }
    }
  }

  return [...new Set(phrases)].slice(0, 5);
}

// Known voicemailer names that appear in transcripts
const KNOWN_VOICEMAILERS = [
  'Kev', 'birria', 'Paul Atreides', 'Paul Atriedeez',
];

// Common host names for exclusion
const HOST_NAMES = new Set([
  'matt haitch', 'haitch matt', 'jason goldman', 'jason', 'haitch',
  'matt', 'h', 'unknown speaker',
]);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function generateGuestQuery(metadata: EpisodeMetadata): EvalCase | null {
  if (!metadata.guest) return null;

  const templates = [
    `what did ${metadata.guest} think about ${metadata.film}`,
    `${metadata.guest}'s thoughts on the podcast about ${metadata.film}`,
    `what did ${metadata.guest} say during the ${metadata.film} episode`,
  ];

  return {
    name: `Guest query: ${metadata.guest} on ${metadata.film}`,
    query: randomPick(templates),
    tags: ['synthetic', 'guest'],
    expectSourceEpisode: metadata.film.split('(')[0].trim(),
    expectMinTranscriptSources: 1,
    rejectTextInAnswer: ['no information', "don't have"],
  };
}

function generateFilmQuery(metadata: EpisodeMetadata): EvalCase {
  const templates = [
    `which episode covers ${metadata.film}`,
    `what did the hosts think about ${metadata.film}`,
    `tell me about the ${metadata.film} episode`,
  ];

  const filmShort = metadata.film.split('(')[0].trim();

  return {
    name: `Film query: ${metadata.film}`,
    query: randomPick(templates),
    tags: ['synthetic', 'film'],
    expectEpisodeInAnswer: filmShort,
    expectSourceEpisode: filmShort,
    rejectTextInAnswer: ['no information', "don't have"],
  };
}

function generateDirectorQuery(metadata: EpisodeMetadata): EvalCase | null {
  if (!metadata.directors || metadata.directors.length === 0) return null;

  const director = metadata.directors[0];
  const templates = [
    `${director} movies covered on the podcast`,
    `what has the podcast said about ${director} films`,
  ];

  return {
    name: `Director query: ${director}`,
    query: randomPick(templates),
    tags: ['synthetic', 'director', 'factual'],
    expectClassificationType: ['factual', 'hybrid'],
    expectMinSources: 1,
  };
}

function generateTranscriptContentQuery(
  transcript: Transcript,
  dialogues: DialogueEntry[]
): EvalCase | null {
  // Find a dialogue with a distinctive phrase from a non-host speaker
  const nonHostDialogues = dialogues.filter(
    (d) => !HOST_NAMES.has(d.name.toLowerCase()) && d.text.length > 50
  );

  if (nonHostDialogues.length === 0) return null;

  const dialogue = randomPick(nonHostDialogues);
  const phrases = extractDistinctivePhrases(dialogue.text);
  if (phrases.length === 0) return null;

  const phrase = randomPick(phrases);
  const epName = transcript.episode_name;
  const epShort = epName.split('(')[0].trim();

  return {
    name: `Transcript content: "${phrase}" in ${epName}`,
    query: `which episode mentions "${phrase}"`,
    tags: ['synthetic', 'transcript-content'],
    expectSourceEpisode: epShort,
    expectMinTranscriptSources: 1,
    rejectTextInAnswer: ['no information', "don't have"],
  };
}

function generateVoicemailQuery(
  metadata: EpisodeMetadata
): EvalCase | null {
  if (!metadata.kevsQuestion || metadata.kevsQuestion.trim() === '') return null;

  // Kev's question is in metadata — use it to form a query
  const filmShort = metadata.film.split('(')[0].trim();

  return {
    name: `Kev's question on ${metadata.film}`,
    query: `what was Kev's question during the ${filmShort} episode`,
    tags: ['synthetic', 'voicemail', 'kev'],
    expectSourceEpisode: filmShort,
    expectMinTranscriptSources: 1,
    rejectTextInAnswer: ['no information', "don't have"],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string | number> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      opts.count = parseInt(args[++i], 10);
    } else if (args[i] === '--out' && args[i + 1]) {
      opts.out = args[++i];
    } else if (args[i] === '--seed' && args[i + 1]) {
      opts.seed = parseInt(args[++i], 10);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  const targetCount = (opts.count as number) || 30;
  const transcriptsDir = path.join(__dirname, '..', 'transcripts');
  const metadataPath = path.join(__dirname, '..', 'data', 'episode-metadata.json');

  // Load metadata
  const allMetadata: EpisodeMetadata[] = JSON.parse(
    fs.readFileSync(metadataPath, 'utf-8')
  );

  // Load transcripts
  const transcriptFiles = fs
    .readdirSync(transcriptsDir)
    .filter((f) => f.endsWith('.json'));

  const transcripts: Transcript[] = [];
  for (const file of transcriptFiles) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(transcriptsDir, file), 'utf-8')
      );
      if (data.dialogues && data.episode_name) {
        transcripts.push(data);
      }
    } catch {
      // Skip malformed files
    }
  }

  console.error(
    `Loaded ${allMetadata.length} metadata entries, ${transcripts.length} transcripts`
  );

  const cases: EvalCase[] = [];
  const usedNames = new Set<string>();

  function addCase(c: EvalCase | null) {
    if (!c || usedNames.has(c.name)) return false;
    usedNames.add(c.name);
    cases.push(c);
    return true;
  }

  // Strategy 1: Guest queries (from metadata entries with guests)
  const withGuests = shuffle(allMetadata.filter((m) => m.guest));
  for (const meta of withGuests) {
    if (cases.length >= targetCount) break;
    addCase(generateGuestQuery(meta));
  }

  // Strategy 2: Film queries (random sample of films)
  const shuffledMeta = shuffle(allMetadata);
  for (const meta of shuffledMeta) {
    if (cases.length >= targetCount) break;
    addCase(generateFilmQuery(meta));
  }

  // Strategy 3: Director queries
  const withDirectors = shuffle(
    allMetadata.filter((m) => m.directors && m.directors.length > 0)
  );
  const seenDirectors = new Set<string>();
  for (const meta of withDirectors) {
    if (cases.length >= targetCount) break;
    const dir = meta.directors![0];
    if (seenDirectors.has(dir)) continue;
    seenDirectors.add(dir);
    addCase(generateDirectorQuery(meta));
  }

  // Strategy 4: Transcript content queries
  const shuffledTranscripts = shuffle(transcripts);
  for (const transcript of shuffledTranscripts) {
    if (cases.length >= targetCount) break;
    addCase(
      generateTranscriptContentQuery(transcript, transcript.dialogues)
    );
  }

  // Strategy 5: Kev's question queries
  const withKev = shuffle(
    allMetadata.filter((m) => m.kevsQuestion && m.kevsQuestion.trim() !== '')
  );
  for (const meta of withKev) {
    if (cases.length >= targetCount) break;
    addCase(generateVoicemailQuery(meta));
  }

  console.error(`Generated ${cases.length} eval cases`);

  const output = JSON.stringify({ cases }, null, 2);

  if (opts.out) {
    const outPath = path.resolve(opts.out as string);
    fs.writeFileSync(outPath, output);
    console.error(`Written to ${outPath}`);
  } else {
    console.log(output);
  }
}

main();
