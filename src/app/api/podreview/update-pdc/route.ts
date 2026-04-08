import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/podreview-auth';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

const SHEET_ID = '1RbtWP966CxA57PatyMcbJ6_ylg9tmCvDSLNxjmQ4bvk';
const SHEET_TAB = 'Pod Data Detail';

// Column keys in the order the form sends them
const COLUMN_KEYS = [
  'Pod', 'Season', 'Ep', 'Film', 'Release_Date', 'Length', 'Length_minutes',
  'Reviewer', 'Guest', 'MMM_Count', 'Thats_Great_Count', 'Notable_Moments',
  'H_Flex', 'J_Flex', 'Kevs_Question', 'TildaH', 'TildaJason', 'TildaGuest',
  'TildaCorey', 'Chuckle_Hut_Favorites', 'Show_Link', 'Artwork_Link',
  'Letterboxd_Link', 'IMDB_Link',
];

// Header name variations the sheet might use
const HEADER_ALIASES: Record<string, string[]> = {
  Ep: ['Ep', 'Episode'],
  Release_Date: ['Release_Date', 'Release Date', 'Timestamp'],
  Length_minutes: ['Length_minutes', 'Length minutes'],
  MMM_Count: ['MMM_Count', 'MMM Count'],
  Thats_Great_Count: ['Thats_Great_Count', "That's Great Count", 'Thats Great Count'],
  Notable_Moments: ['Notable_Moments', 'Notable Moments'],
  H_Flex: ['H_Flex', 'H Flex'],
  J_Flex: ['J_Flex', 'J Flex'],
  Kevs_Question: ['Kevs_Question', "Kev's Question", 'Kevs Question'],
  TildaH: ['TildaH', 'Tilda H', 'H Tilda'],
  TildaJason: ['TildaJason', 'Tilda Jason', 'J Tilda'],
  TildaGuest: ['TildaGuest', 'Tilda Guest', 'Guest Tilda'],
  TildaCorey: ['TildaCorey', 'Tilda Corey', 'Corey Tilda'],
  Chuckle_Hut_Favorites: ['Chuckle_Hut_Favorites', 'Chuckle Hut Favorites'],
  Show_Link: ['Show_Link', 'Show Link'],
  Artwork_Link: ['Artwork_Link', 'Artwork Link'],
  Letterboxd_Link: ['Letterboxd_Link', 'Letterboxd Link'],
  IMDB_Link: ['IMDB_Link', 'IMDB Link'],
};

function getAuth() {
  // Prefer JSON env var (Vercel / CI)
  const jsonKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (jsonKey) {
    const credentials = JSON.parse(jsonKey);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  // Fall back to key file (local dev)
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (keyFile) {
    const keyPath = path.resolve(process.cwd(), keyFile);
    if (fs.existsSync(keyPath)) {
      return new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
  }

  return null;
}

/** Map sheet header row to canonical key → column index */
function mapHeaders(headerRow: string[]): Map<string, number> {
  const headerToCol = new Map<string, number>();
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = headerRow.findIndex(h => h.trim() === alias);
      if (idx !== -1) {
        headerToCol.set(canonical, idx);
        break;
      }
    }
  }
  // Direct match for keys without aliases
  for (const key of COLUMN_KEYS) {
    if (!headerToCol.has(key) && !HEADER_ALIASES[key]) {
      const idx = headerRow.findIndex(h => h.trim() === key);
      if (idx !== -1) headerToCol.set(key, idx);
    }
  }
  return headerToCol;
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = getAuth();
  if (!auth) {
    const hasJson = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
    const hasFile = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    return NextResponse.json(
      { error: `Google Sheets credentials not configured (JSON: ${hasJson}, FILE: ${hasFile})` },
      { status: 500 }
    );
  }

  const data = await request.json();

  // Validate required fields
  const required = ['film', 'episode', 'pod', 'season', 'reviewer'];
  const missing = required.filter(f => !data[f] && data[f] !== 0);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(', ')}` },
      { status: 400 }
    );
  }

  // Build the row data (canonical key → value)
  const rowData: Record<string, string> = {
    Pod: data.pod || 'EH',
    Season: String(data.season ?? 0),
    Ep: String(data.episode),
    Film: data.film,
    Release_Date: data.releaseDate || '',
    Length: data.length || '',
    Length_minutes: data.lengthMinutes || '',
    Reviewer: data.reviewer || '',
    Guest: data.guest || '',
    MMM_Count: String(data.mmmCount ?? 0),
    Thats_Great_Count: String(data.thatsGreatCount ?? 0),
    Notable_Moments: data.notableMoments || '',
    H_Flex: data.hFlex || '',
    J_Flex: data.jFlex || '',
    Kevs_Question: data.kevsQuestion || '',
    TildaH: data.tildaH || '',
    TildaJason: data.tildaJason || '',
    TildaGuest: data.tildaGuest || '',
    TildaCorey: data.tildaCorey || '',
    Chuckle_Hut_Favorites: '',
    Show_Link: data.showLink || '',
    Artwork_Link: data.artworkLink || '',
    Letterboxd_Link: data.letterboxdLink || '',
    IMDB_Link: data.imdbLink || '',
  };

  const sheets = google.sheets({ version: 'v4', auth });

  try {
    // Read all data from the sheet
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${SHEET_TAB}'`,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'Sheet is empty or not found' }, { status: 500 });
    }

    const headerRow = rows[0].map((h: string) => String(h).trim());
    const headerMap = mapHeaders(headerRow);

    const epColIdx = headerMap.get('Ep');
    if (epColIdx === undefined) {
      return NextResponse.json({ error: 'Could not find Ep column in sheet' }, { status: 500 });
    }

    // Find existing row by Ep match
    const targetEp = String(data.episode).trim().toLowerCase();
    let matchRowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      const cellVal = String(rows[i][epColIdx] || '').trim().toLowerCase();
      if (cellVal === targetEp) {
        matchRowIdx = i;
        break;
      }
    }

    if (matchRowIdx !== -1) {
      // UPDATE: only overwrite cells where new value is non-empty
      const existingRow = rows[matchRowIdx];
      const updatedRow = [...existingRow];
      // Ensure row is wide enough
      while (updatedRow.length <= Math.max(...Array.from(headerMap.values()))) {
        updatedRow.push('');
      }

      let changedFields: string[] = [];
      for (const [key, colIdx] of headerMap) {
        const newVal = rowData[key];
        if (newVal === undefined) continue;
        // Don't overwrite with blank
        if (newVal === '' || newVal === null) continue;
        const oldVal = String(updatedRow[colIdx] || '').trim();
        if (oldVal !== newVal.trim()) {
          updatedRow[colIdx] = newVal;
          changedFields.push(key);
        }
      }

      if (changedFields.length === 0) {
        return NextResponse.json({
          ok: true,
          action: 'no_change',
          message: `Episode ${data.episode} — no fields changed.`,
        });
      }

      // Write the updated row (1-indexed: header is row 1, data starts at row 2)
      const sheetRowNum = matchRowIdx + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'${SHEET_TAB}'!A${sheetRowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updatedRow] },
      });

      return NextResponse.json({
        ok: true,
        action: 'updated',
        message: `Updated episode ${data.episode} (${changedFields.length} field${changedFields.length === 1 ? '' : 's'} changed: ${changedFields.join(', ')}).`,
      });
    } else {
      // INSERT: append new row in column order
      const newRow: string[] = [];
      const maxCol = Math.max(...Array.from(headerMap.values()));
      for (let i = 0; i <= maxCol; i++) newRow.push('');
      for (const [key, colIdx] of headerMap) {
        newRow[colIdx] = rowData[key] ?? '';
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `'${SHEET_TAB}'!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [newRow] },
      });

      return NextResponse.json({
        ok: true,
        action: 'inserted',
        message: `Inserted new row for episode ${data.episode}.`,
      });
    }
  } catch (err: unknown) {
    console.error('Google Sheets update error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Sheet update failed: ${message}` }, { status: 500 });
  }
}
