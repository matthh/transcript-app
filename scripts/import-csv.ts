import * as fs from 'fs';
import * as path from 'path';

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
  [key: string]: string; // Allow extra columns
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
}

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
        // Escaped quote
        currentField += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      // End of row (skip \r\n as single newline)
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

  // Don't forget the last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function parseFilmYear(filmTitle: string): number | null {
  // Match year in parentheses at the end, e.g., "Blade Runner 2049 (2017)"
  const match = filmTitle.match(/\((\d{4})\)\s*$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

function parseNumber(value: string): number {
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}

function parseOptionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'n/a' ? null : trimmed;
}

function convertRow(row: RawCSVRow): EpisodeMetadata {
  return {
    pod: row.Pod,
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
    notableMoments: row.Notable_Moments,
    hFlex: row.H_Flex,
    jFlex: row.J_Flex,
    kevsQuestion: row.Kevs_Question,
    tildaH: row.TildaH,
    tildaJason: row.TildaJason,
    tildaGuest: parseOptionalString(row.TildaGuest),
    tildaCorey: parseOptionalString(row.TildaCorey),
    showLink: row.Show_Link,
    artworkLink: row.Artwork_Link,
    letterboxdLink: row.Letterboxd_Link,
    imdbLink: row.IMDB_Link,
  };
}

function importCSV(csvPath: string, outputPath: string): void {
  console.log(`Reading CSV from: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    console.log('\nUsage: npx tsx scripts/import-csv.ts <path-to-csv>');
    console.log('Example: npx tsx scripts/import-csv.ts ./episodes.csv');
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(content);

  if (rows.length < 2) {
    console.error('CSV file must have a header row and at least one data row');
    process.exit(1);
  }

  const headers = rows[0];
  console.log(`Found ${headers.length} columns: ${headers.slice(0, 24).join(', ')}`);
  console.log(`Total rows in CSV: ${rows.length}`);

  const episodes: EpisodeMetadata[] = [];

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];

    const row: RawCSVRow = {} as RawCSVRow;
    headers.forEach((header, index) => {
      (row as Record<string, string>)[header] = values[index] || '';
    });

    // Skip rows without a film title (likely empty/filler rows)
    if (!row.Film || row.Film.trim() === '') {
      continue;
    }

    try {
      const episode = convertRow(row);
      episodes.push(episode);
    } catch (error) {
      console.warn(`Row ${i + 1}: Failed to parse - ${error}`);
    }
  }

  console.log(`\nProcessed ${episodes.length} episodes`);

  // Show some stats
  const withYears = episodes.filter((e) => e.filmYear !== null);
  const withGuests = episodes.filter((e) => e.guest !== null);
  const decades = new Set(
    withYears.map((e) => Math.floor(e.filmYear! / 10) * 10)
  );

  console.log(`- ${withYears.length} episodes have parseable film years`);
  console.log(`- ${withGuests.length} episodes have guests`);
  console.log(`- Decades covered: ${Array.from(decades).sort().join(', ')}`);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(episodes, null, 2));
  console.log(`\nWritten to: ${outputPath}`);
}

// Main execution
const args = process.argv.slice(2);
const csvPath = args[0] || './episodes.csv';
const outputPath =
  args[1] || path.join(process.cwd(), 'data', 'episode-metadata.json');

importCSV(csvPath, outputPath);
