import { NextRequest, NextResponse } from 'next/server';
import { classifyQuery } from '@/lib/query-classifier';
import { queryEpisodes, loadEpisodeMetadata } from '@/lib/metadata-store';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    const allEpisodes = loadEpisodeMetadata();
    const classification = await classifyQuery(query);

    let metadataResult = null;
    if (Object.keys(classification.filters).length > 0) {
      metadataResult = queryEpisodes(classification.filters);
    }

    return NextResponse.json({
      query,
      totalEpisodes: allEpisodes.length,
      classification,
      metadataResult: metadataResult ? {
        count: metadataResult.episodes.length,
        matchedFilters: metadataResult.matchedFilters,
        firstMatch: metadataResult.episodes[0]?.film
      } : null,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
