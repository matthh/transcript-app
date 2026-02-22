import { NextRequest, NextResponse } from 'next/server';
import { list } from '@vercel/blob';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const ratingFilter = searchParams.get('rating');
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 200) : 50;

    // Build prefix for Blob listing
    const prefix = month
      ? `eval-human/${month}/`
      : 'eval-human/';

    const blobs = await list({ prefix });

    // Fetch and parse each blob
    const entries = await Promise.all(
      blobs.blobs.map(async (blob) => {
        try {
          const response = await fetch(blob.url, { cache: 'no-store' });
          if (!response.ok) return null;
          return await response.json();
        } catch {
          return null;
        }
      })
    );

    let results = entries.filter(Boolean);

    // Apply rating filter
    if (ratingFilter === 'good' || ratingFilter === 'bad') {
      results = results.filter((e) => e.rating === ratingFilter);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Apply limit
    results = results.slice(0, limit);

    return NextResponse.json({
      count: results.length,
      entries: results,
    });
  } catch (err) {
    console.error('Eval results error:', err);
    return NextResponse.json(
      { error: 'Failed to retrieve results' },
      { status: 500 }
    );
  }
}
