/**
 * Sync episode metadata from canonical Google Sheet.
 *
 * Usage:
 *   npm run sync-metadata              # Sync and preserve TMDB data
 *   npm run sync-metadata -- --dry-run # Preview changes without writing
 *   npm run sync-metadata -- --force-tmdb # Re-enrich all episodes with TMDB
 *
 * Prerequisites:
 *   - Google Sheet must be publicly viewable (Anyone with link → Viewer)
 *   - Or set GOOGLE_SHEETS_API_KEY in .env.local
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// Google Sheet ID from the URL
const SHEET_ID = '1RbtWP966CxA57PatyMcbJ6_ylg9tmCvDSLNxjmQ4bvk';
const SHEET_GID = '0'; // First sheet

// CLI flags
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const forceTmdb = args.includes('--force-tmdb');
const verbose = args.includes('--verbose');

interface RawCSVRow {
  Pod: string;
  Season: string;
  Ep: string;
  Film: string;
  Release_Date: string;
  Length: string;
  Length_minutes: string;
  Reviewer: string;
  Guest: string;
  MMM_Count: string;
  Thats_Great_Count: string;
  Notable_Moments: string;
  H_Flex: string;
  J_Flex: string;
  Kevs_Question: string;
  TildaH: string;
  TildaJason: string;
  TildaGuest: string;
  TildaCorey: string;
  Chuckle_Hut_Favorites: string;
  Show_Link: string;
  Artwork_Link: string;
  Letterboxd_Link: string;
  IMDB_Link: string;
  [key: string]: string;
}

interface EpisodeMetadata {
  pod: string;
  season: number;
  episode: number;
  film: string;
  filmYear: number | null;
  releaseDate: string;
  length: string;
  reviewer: string;
  guest: string | null;
  mmmCount: number;
  thatsGreatCount: number;
  notableMoments: string;
  hFlex: string;
  jFlex: string;
  kevsQuestion: string;
  tildaH: string;
  tildaJason: string;
  tildaGuest: string | null;
  tildaCorey: string | null;
  showLink: string;
  artworkLink: string;
  letterboxdLink: string;
  imdbLink: string;
  // TMDB fields (preserved from existing data)
  tmdbId?: number;
  directors?: string[];
  cinematographers?: string[];
  cast?: string[];
  genres?: string[];
  tmdbPosterPath?: string;
}

// ---------- CSV Parsing ----------

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentField.trim());
      if (currentRow.some(field => field !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function parseFilmYear(filmTitle: string): number | null {
  const match = filmTitle.match(/\((\d{4})\)\s*$/);
  return match ? parseInt(match[1], 10) : null;
}

function parseNumber(value: string): number {
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}

function parseOptionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'n/a' || trimmed.toLowerCase() === 'none' ? null : trimmed;
}

function convertRow(row: RawCSVRow): EpisodeMetadata {
  return {
    pod: row.Pod || 'EH',
    season: parseNumber(row.Season),
    episode: parseNumber(row.Ep),
    film: row.Film,
    filmYear: parseFilmYear(row.Film),
    releaseDate: row.Release_Date,
    length: row.Length,
    reviewer: row.Reviewer,
    guest: parseOptionalString(row.Guest),
    mmmCount: parseNumber(row.MMM_Count),
    thatsGreatCount: parseNumber(row.Thats_Great_Count),
    notableMoments: row.Notable_Moments || '',
    hFlex: row.H_Flex || 'N/A',
    jFlex: row.J_Flex || 'N/A',
    kevsQuestion: row.Kevs_Question || 'N/A',
    tildaH: row.TildaH || 'N/A',
    tildaJason: row.TildaJason || 'N/A',
    tildaGuest: parseOptionalString(row.TildaGuest),
    tildaCorey: parseOptionalString(row.TildaCorey),
    showLink: row.Show_Link || '',
    artworkLink: row.Artwork_Link || '',
    letterboxdLink: row.Letterboxd_Link || '',
    imdbLink: row.IMDB_Link || '',
  };
}

// ---------- Google Sheets Fetching ----------

async function fetchSheetAsCSV(): Promise<string> {
  const exportUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

  console.log('Fetching from Google Sheets...');
  if (verbose) console.log(`  URL: ${exportUrl}`);

  const response = await fetch(exportUrl);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Sheet is not publicly accessible. Please:\n' +
        '  1. Open the Google Sheet\n' +
        '  2. Click Share → "Anyone with the link" → Viewer\n' +
        '  Or set GOOGLE_SHEETS_API_KEY in .env.local'
      );
    }
    throw new Error(`Failed to fetch sheet: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

// ---------- TMDB Data Preservation ----------

function loadExistingMetadata(): Map<string, EpisodeMetadata> {
  const metadataPath = path.join(process.cwd(), 'src', 'lib', 'metadata-data.ts');

  if (!fs.existsSync(metadataPath)) {
    console.log('No existing metadata-data.ts found, starting fresh.');
    return new Map();
  }

  try {
    // Read the file and extract the JSON array
    const content = fs.readFileSync(metadataPath, 'utf-8');
    const match = content.match(/export const episodeMetadata[^=]*=\s*(\[[\s\S]*\]);?\s*$/);

    if (!match) {
      console.warn('Could not parse existing metadata-data.ts');
      return new Map();
    }

    const episodes: EpisodeMetadata[] = JSON.parse(match[1]);
    const map = new Map<string, EpisodeMetadata>();

    for (const ep of episodes) {
      // Key by pod-season-episode for unique identification
      const key = `${ep.pod}-${ep.season}-${ep.episode}`;
      map.set(key, ep);
    }

    console.log(`Loaded ${map.size} existing episodes with TMDB data.`);
    return map;
  } catch (error) {
    console.warn('Error loading existing metadata:', error);
    return new Map();
  }
}

function mergeWithExisting(
  newEpisodes: EpisodeMetadata[],
  existing: Map<string, EpisodeMetadata>
): { merged: EpisodeMetadata[]; newCount: number; updatedCount: number } {
  let newCount = 0;
  let updatedCount = 0;

  const merged = newEpisodes.map(ep => {
    const key = `${ep.pod}-${ep.season}-${ep.episode}`;
    const existingEp = existing.get(key);

    if (!existingEp) {
      newCount++;
      if (verbose) console.log(`  NEW: S${ep.season}E${ep.episode} - ${ep.film}`);
      return ep;
    }

    // Check if core data changed
    const coreChanged =
      existingEp.film !== ep.film ||
      existingEp.reviewer !== ep.reviewer ||
      existingEp.guest !== ep.guest;

    if (coreChanged) {
      updatedCount++;
      if (verbose) console.log(`  UPDATED: S${ep.season}E${ep.episode} - ${ep.film}`);
    }

    // Preserve TMDB data from existing (unless --force-tmdb)
    if (!forceTmdb && existingEp.tmdbId) {
      return {
        ...ep,
        tmdbId: existingEp.tmdbId,
        directors: existingEp.directors,
        cinematographers: existingEp.cinematographers,
        cast: existingEp.cast,
        genres: existingEp.genres,
        tmdbPosterPath: existingEp.tmdbPosterPath,
      };
    }

    return ep;
  });

  return { merged, newCount, updatedCount };
}

// ---------- Output Generation ----------

function generateMetadataTS(episodes: EpisodeMetadata[]): string {
  const date = new Date().toISOString().split('T')[0];
  const json = JSON.stringify(episodes, null, 2);

  return `// Auto-generated - do not edit - ${episodes.length} episodes - updated ${date}
import { EpisodeMetadata } from '@/types/episode-metadata';
export const episodeMetadata: EpisodeMetadata[] = ${json};
`;
}

// ---------- Main ----------

async function main() {
  console.log('=== Metadata Sync from Google Sheet ===\n');

  if (dryRun) {
    console.log('DRY RUN - no files will be written\n');
  }

  // Fetch from Google Sheets
  let csvContent: string;
  try {
    csvContent = await fetchSheetAsCSV();
  } catch (error) {
    console.error('Error fetching sheet:', error);
    process.exit(1);
  }

  // Parse CSV
  const rows = parseCSV(csvContent);
  if (rows.length < 2) {
    console.error('Sheet must have a header row and at least one data row');
    process.exit(1);
  }

  const headers = rows[0];
  console.log(`Found ${headers.length} columns, ${rows.length - 1} data rows`);

  // Convert to episodes
  const episodes: EpisodeMetadata[] = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const row: RawCSVRow = {} as RawCSVRow;

    headers.forEach((header, index) => {
      (row as Record<string, string>)[header] = values[index] || '';
    });

    // Skip rows without a film title
    if (!row.Film || row.Film.trim() === '') {
      continue;
    }

    try {
      episodes.push(convertRow(row));
    } catch (error) {
      console.warn(`Row ${i + 1}: Failed to parse - ${error}`);
    }
  }

  console.log(`Parsed ${episodes.length} episodes from sheet\n`);

  // Load existing and merge
  const existing = loadExistingMetadata();
  const { merged, newCount, updatedCount } = mergeWithExisting(episodes, existing);

  // Count episodes with TMDB data
  const withTmdb = merged.filter(e => e.tmdbId).length;
  const withoutTmdb = merged.filter(e => !e.tmdbId && e.filmYear).length;

  console.log(`\nSync Summary:`);
  console.log(`  Total episodes: ${merged.length}`);
  console.log(`  New episodes: ${newCount}`);
  console.log(`  Updated episodes: ${updatedCount}`);
  console.log(`  With TMDB data: ${withTmdb}`);
  console.log(`  Need TMDB enrichment: ${withoutTmdb}`);

  if (withoutTmdb > 0 && !dryRun) {
    console.log(`\n  Tip: Run 'npm run enrich-tmdb' to add TMDB data to new episodes.`);
  }

  // Write output
  if (!dryRun) {
    const outputPath = path.join(process.cwd(), 'src', 'lib', 'metadata-data.ts');
    const content = generateMetadataTS(merged);
    fs.writeFileSync(outputPath, content);
    console.log(`\nWritten to: ${outputPath}`);
  } else {
    console.log('\nDry run complete. Use without --dry-run to write changes.');
  }
}

main().catch(console.error);
