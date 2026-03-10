/**
 * Sync episode metadata from canonical Google Sheet.
 *
 * Usage:
 *   npm run sync-metadata              # Sync and preserve TMDB data
 *   npm run sync-metadata -- --dry-run # Preview changes without writing
 *   npm run sync-metadata -- --force-tmdb # Re-enrich all episodes with TMDB
 *
 * Authentication (in order of preference):
 *   1. Service Account: Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE in .env.local
 *   2. API Key (public sheets only): Set GOOGLE_SHEETS_API_KEY in .env.local
 *   3. Public CSV export (no auth needed if sheet is public)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { google } from 'googleapis';
import { episodeSortKey, type EpisodeId } from '../src/lib/episode-format';

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
  episode: EpisodeId;
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

function parseEpisodeId(value: string): EpisodeId {
  const trimmed = (value || '').trim();
  if (!trimmed) return 0;
  return /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : trimmed;
}

function normalizeEpisodeId(value: EpisodeId): string {
  return String(value).trim().toLowerCase();
}

function parseOptionalString(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'n/a' || trimmed.toLowerCase() === 'none' ? null : trimmed;
}

function convertRow(row: RawCSVRow): EpisodeMetadata {
  // Helper to safely get string value
  const str = (key: string): string => row[key] || '';

  return {
    pod: str('Pod') || 'EH',
    season: parseNumber(str('Season')),
    episode: parseEpisodeId(str('Ep') || str('Episode')),
    film: str('Film'),
    filmYear: parseFilmYear(str('Film')),
    releaseDate: str('Release_Date') || str('Release Date') || str('Timestamp') || '',
    length: str('Length') || '',
    reviewer: str('Reviewer'),
    guest: parseOptionalString(str('Guest')),
    mmmCount: parseNumber(str('MMM_Count') || str('MMM Count')),
    thatsGreatCount: parseNumber(str('Thats_Great_Count') || str("That's Great Count")),
    notableMoments: str('Notable_Moments') || str('Notable Moments') || '',
    hFlex: str('H_Flex') || str('H Flex') || 'N/A',
    jFlex: str('J_Flex') || str('J Flex') || 'N/A',
    kevsQuestion: str('Kevs_Question') || str("Kev's Question") || 'N/A',
    tildaH: str('TildaH') || str('Tilda H') || str('H Tilda') || 'N/A',
    tildaJason: str('TildaJason') || str('Tilda Jason') || str('J Tilda') || 'N/A',
    tildaGuest: parseOptionalString(str('TildaGuest') || str('Tilda Guest') || str('Guest Tilda')),
    tildaCorey: parseOptionalString(str('TildaCorey') || str('Tilda Corey') || str('Corey Tilda')),
    showLink: str('Show_Link') || str('Show Link') || '',
    artworkLink: str('Artwork_Link') || str('Artwork Link') || '',
    letterboxdLink: str('Letterboxd_Link') || str('Letterboxd Link') || '',
    imdbLink: str('IMDB_Link') || str('IMDB Link') || '',
  };
}

// ---------- Google Sheets Fetching ----------

async function fetchWithServiceAccount(): Promise<string[][] | null> {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

  if (!keyFile) return null;

  const keyPath = path.resolve(process.cwd(), keyFile);
  if (!fs.existsSync(keyPath)) {
    console.warn(`Service account key file not found: ${keyPath}`);
    return null;
  }

  console.log('Authenticating with service account...');

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Pick the worksheet that actually has episode identifiers.
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: 'sheets(properties(title,sheetId))',
  });

  const sheetProps = spreadsheet.data.sheets?.map(s => s.properties).filter(Boolean) || [];
  let bestValues: string[][] | null = null;
  let bestTitle = '';
  let bestScore = -1;

  for (const props of sheetProps) {
    const title = props?.title || '';
    if (!title) continue;

    const escapedTitle = title.replace(/'/g, "''");
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${escapedTitle}'!A:Z`,
    });

    const values = response.data.values || [];
    const headers = (values[0] || []).map(h => String(h).toLowerCase().trim());
    if (headers.length === 0) continue;

    const hasFilm = headers.includes('film');
    const hasEpisode = headers.includes('ep') || headers.includes('episode');
    const hasSeason = headers.includes('season');
    const hasReleaseDate = headers.includes('release_date') || headers.includes('release date') || headers.includes('timestamp');

    let score = 0;
    if (hasFilm) score += 2;
    if (hasEpisode) score += 3;
    if (hasSeason) score += 1;
    if (hasReleaseDate) score += 1;
    score += Math.min(values.length, 500) / 500;

    if (score > bestScore) {
      bestScore = score;
      bestValues = values;
      bestTitle = title;
    }
  }

  if (bestValues && bestValues.length > 0) {
    console.log(`  Using sheet tab: ${bestTitle}`);
    return bestValues;
  }

  return null;
}

async function fetchWithApiKey(): Promise<string[][] | null> {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

  // Check if API key looks like a real key (not a URL)
  if (!apiKey || apiKey.startsWith('http')) return null;

  console.log('Fetching via Google Sheets API key...');

  // Fetch sheet list first so we can select the correct tab.
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets(properties(title,sheetId))&key=${apiKey}`;
  const metaResp = await fetch(metaUrl);
  if (!metaResp.ok) {
    const error = await metaResp.text();
    console.warn(`API key metadata fetch failed: ${metaResp.status} - ${error}`);
    return null;
  }
  const meta = await metaResp.json();
  const sheetProps: Array<{ properties?: { title?: string } }> = meta.sheets || [];

  let bestValues: string[][] | null = null;
  let bestTitle = '';
  let bestScore = -1;

  for (const s of sheetProps) {
    const title = s.properties?.title || '';
    if (!title) continue;
    const range = `'${title.replace(/'/g, "''")}'!A:Z`;
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${apiKey}`;
    const response = await fetch(apiUrl);
    if (!response.ok) continue;
    const data = await response.json();
    const values: string[][] = data.values || [];
    const headers = (values[0] || []).map((h: string) => String(h).toLowerCase().trim());
    if (headers.length === 0) continue;

    const hasFilm = headers.includes('film');
    const hasEpisode = headers.includes('ep') || headers.includes('episode');
    const hasSeason = headers.includes('season');
    const hasReleaseDate = headers.includes('release_date') || headers.includes('release date') || headers.includes('timestamp');

    let score = 0;
    if (hasFilm) score += 2;
    if (hasEpisode) score += 3;
    if (hasSeason) score += 1;
    if (hasReleaseDate) score += 1;
    score += Math.min(values.length, 500) / 500;

    if (score > bestScore) {
      bestScore = score;
      bestValues = values;
      bestTitle = title;
    }
  }

  if (bestValues && bestValues.length > 0) {
    console.log(`  Using sheet tab: ${bestTitle}`);
    return bestValues;
  }

  return null;
}

async function fetchPublicCSV(): Promise<string[][] | null> {
  const exportUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

  console.log('Fetching from Google Sheets (public export)...');
  if (verbose) console.log(`  URL: ${exportUrl}`);

  const response = await fetch(exportUrl);

  if (!response.ok) {
    return null;
  }

  const csvContent = await response.text();
  return parseCSV(csvContent);
}

async function fetchSheetData(): Promise<string[][]> {
  // Try service account first
  let data = await fetchWithServiceAccount();
  if (data && data.length > 0) {
    console.log('  Successfully authenticated with service account.');
    return data;
  }

  // Try API key
  data = await fetchWithApiKey();
  if (data && data.length > 0) {
    console.log('  Successfully fetched with API key.');
    return data;
  }

  // Try public export
  data = await fetchPublicCSV();
  if (data && data.length > 0) {
    console.log('  Successfully fetched public sheet.');
    return data;
  }

  throw new Error(
    'Could not access the Google Sheet. Options:\n' +
    '  1. Service Account: Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE in .env.local\n' +
    '     - Create service account in Google Cloud Console\n' +
    '     - Download JSON key file\n' +
    '     - Share sheet with service account email as Viewer\n' +
    '  2. Make sheet public: Share → "Anyone with the link" → Viewer'
  );
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

function normalizeFilmTitle(title: string): string {
  // Normalize for matching: lowercase, remove year suffix, trim
  return title.toLowerCase().replace(/\s*\(\d{4}\)\s*$/, '').trim();
}

function mergeWithExisting(
  sheetEpisodes: EpisodeMetadata[],
  existing: Map<string, EpisodeMetadata>
): { merged: EpisodeMetadata[]; newCount: number; updatedCount: number } {
  let newCount = 0;
  let updatedCount = 0;

  // Build a map of sheet data by normalized film title
  const sheetByFilm = new Map<string, EpisodeMetadata>();
  const sheetByEpisode = new Map<string, EpisodeMetadata>();
  for (const ep of sheetEpisodes) {
    sheetByFilm.set(normalizeFilmTitle(ep.film), ep);
    sheetByEpisode.set(normalizeEpisodeId(ep.episode), ep);
  }

  // Update existing episodes with sheet data and track which sheet rows were consumed
  const merged: EpisodeMetadata[] = [];
  const consumedSheetEpisodeIds = new Set<string>();

  for (const [, existingEp] of existing) {
    const byEpisode = sheetByEpisode.get(normalizeEpisodeId(existingEp.episode));
    const byFilm = sheetByFilm.get(normalizeFilmTitle(existingEp.film));
    const sheetEp = byEpisode || byFilm;

    if (sheetEp) {
      consumedSheetEpisodeIds.add(normalizeEpisodeId(sheetEp.episode));

      // Merge: keep existing core data, update supplementary fields from sheet
      const updated: EpisodeMetadata = {
        ...existingEp,
        // Update these fields if sheet has non-default values
        mmmCount: sheetEp.mmmCount || existingEp.mmmCount,
        thatsGreatCount: sheetEp.thatsGreatCount || existingEp.thatsGreatCount,
        notableMoments: sheetEp.notableMoments || existingEp.notableMoments,
        hFlex: sheetEp.hFlex !== 'N/A' ? sheetEp.hFlex : existingEp.hFlex,
        jFlex: sheetEp.jFlex !== 'N/A' ? sheetEp.jFlex : existingEp.jFlex,
        kevsQuestion: sheetEp.kevsQuestion !== 'N/A' ? sheetEp.kevsQuestion : existingEp.kevsQuestion,
        tildaH: sheetEp.tildaH !== 'N/A' ? sheetEp.tildaH : existingEp.tildaH,
        tildaJason: sheetEp.tildaJason !== 'N/A' ? sheetEp.tildaJason : existingEp.tildaJason,
        tildaGuest: sheetEp.tildaGuest || existingEp.tildaGuest,
        tildaCorey: sheetEp.tildaCorey || existingEp.tildaCorey,
        // Update reviewer/guest if sheet has them
        reviewer: sheetEp.reviewer || existingEp.reviewer,
        guest: sheetEp.guest ?? existingEp.guest,
        // Update links and length from sheet if present
        releaseDate: sheetEp.releaseDate || existingEp.releaseDate,
        length: sheetEp.length || existingEp.length,
        showLink: sheetEp.showLink || existingEp.showLink,
        artworkLink: sheetEp.artworkLink || existingEp.artworkLink,
        letterboxdLink: sheetEp.letterboxdLink || existingEp.letterboxdLink,
        imdbLink: sheetEp.imdbLink || existingEp.imdbLink,
      };

      // Check if anything actually changed
      const changed =
        updated.mmmCount !== existingEp.mmmCount ||
        updated.thatsGreatCount !== existingEp.thatsGreatCount ||
        updated.notableMoments !== existingEp.notableMoments ||
        updated.hFlex !== existingEp.hFlex ||
        updated.jFlex !== existingEp.jFlex ||
        updated.tildaH !== existingEp.tildaH ||
        updated.tildaJason !== existingEp.tildaJason ||
        updated.reviewer !== existingEp.reviewer ||
        updated.guest !== existingEp.guest ||
        updated.releaseDate !== existingEp.releaseDate ||
        updated.length !== existingEp.length ||
        updated.showLink !== existingEp.showLink ||
        updated.artworkLink !== existingEp.artworkLink ||
        updated.letterboxdLink !== existingEp.letterboxdLink ||
        updated.imdbLink !== existingEp.imdbLink;

      if (changed) {
        updatedCount++;
        if (verbose) console.log(`  UPDATED: ${existingEp.film}`);
      }

      merged.push(updated);
    } else {
      // No sheet data for this episode, keep as-is
      merged.push(existingEp);
    }
  }

  // Add new episodes present in sheet but missing from existing metadata
  const newInSheet = sheetEpisodes.filter(ep => {
    const episodeId = normalizeEpisodeId(ep.episode);
    if (!episodeId || episodeId === '0') return false;
    return !consumedSheetEpisodeIds.has(episodeId);
  });

  if (newInSheet.length > 0) {
    for (const ep of newInSheet) {
      merged.push(ep);
      newCount++;
      if (verbose) console.log(`  ADDED: E${ep.episode} - ${ep.film}`);
    }
  }

  if (newInSheet.length > 0 && verbose) {
    console.log(`\n  Added ${newInSheet.length} episode(s) from sheet not in existing data.`);
  }

  merged.sort((a, b) => {
    const seasonCmp = a.season - b.season;
    if (seasonCmp !== 0) return seasonCmp;
    return episodeSortKey(a.episode) - episodeSortKey(b.episode);
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
  let rows: string[][];
  try {
    rows = await fetchSheetData();
  } catch (error) {
    console.error('Error fetching sheet:', error);
    process.exit(1);
  }

  if (rows.length < 2) {
    console.error('Sheet must have a header row and at least one data row');
    process.exit(1);
  }

  const headers = rows[0];
  console.log(`Found ${headers.length} columns, ${rows.length - 1} data rows`);
  console.log(`Columns: ${headers.join(', ')}`);

  // Safety guard: if we don't have episode identifiers, we're likely on the wrong tab/sheet.
  const normalizedHeaders = headers.map(h => String(h).toLowerCase().trim());
  const hasEpisodeHeader = normalizedHeaders.includes('ep') || normalizedHeaders.includes('episode');
  const hasSeasonHeader = normalizedHeaders.includes('season');
  if (!hasEpisodeHeader || !hasSeasonHeader) {
    throw new Error(
      `Sheet headers missing required columns (Season/Ep). ` +
      `Got: ${headers.join(', ')}. Refusing to sync to avoid false backfill/transcription.`
    );
  }

  // Convert to episodes
  const episodes: EpisodeMetadata[] = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const row: RawCSVRow = {} as RawCSVRow;

    headers.forEach((header, index) => {
      (row as Record<string, string>)[header] = values[index] || '';
    });

    // Skip rows without a film title
    const film = row.Film || '';
    if (!film || film.trim() === '') {
      continue;
    }

    // Skip rows that don't include a usable episode id.
    const episodeRaw = (row.Ep || row.Episode || '').trim();
    if (!episodeRaw) {
      if (verbose) console.log(`  SKIP row ${i + 1}: missing Ep/Episode`);
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
  console.log(`  Episodes in sheet: ${episodes.length}`);
  console.log(`  Episodes in existing data: ${existing.size}`);
  console.log(`  New episodes added from sheet: ${newCount}`);
  console.log(`  Episodes updated from sheet: ${updatedCount}`);
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
