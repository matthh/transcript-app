import { NextRequest, NextResponse } from 'next/server';
import { runSearch } from '@/lib/search-pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, limit, offset, variant, depth } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    const result = await runSearch({ query, limit, offset, variant, depth });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed. Please try again.' },
      { status: 500 }
    );
  }
}
