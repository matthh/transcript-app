import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/podreview-auth';

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = await request.json();

  // Phase 1: Log only — do NOT write to the sheet yet.
  // This lets us verify the data shape before making any changes.
  console.log('=== PODREVIEW SUBMISSION ===');
  console.log('Mode:', data.mode); // 'new' or 'update'
  console.log('Episode:', data.episode);
  console.log('Data:', JSON.stringify(data, null, 2));
  console.log('=== END SUBMISSION ===');

  // Validate required fields
  const required = ['film', 'episode', 'pod', 'season', 'reviewer'];
  const missing = required.filter(f => !data[f] && data[f] !== 0);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(', ')}` },
      { status: 400 }
    );
  }

  // Build the row in sheet column order for verification
  const sheetRow = {
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

  console.log('Sheet row (column order):', JSON.stringify(sheetRow, null, 2));

  return NextResponse.json({
    ok: true,
    message: 'Data logged successfully. Sheet write not yet enabled.',
    sheetRow,
  });
}
