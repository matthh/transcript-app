import { NextRequest, NextResponse } from 'next/server';
import { saveShare } from '@/lib/share-storage';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, result } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    if (!result || typeof result !== 'object') {
      return NextResponse.json(
        { error: 'Result is required' },
        { status: 400 }
      );
    }

    const { answer, queryType, sources } = result;

    if (!answer || typeof answer !== 'string') {
      return NextResponse.json(
        { error: 'Answer is required' },
        { status: 400 }
      );
    }

    if (!queryType || !['factual', 'interpretive', 'hybrid'].includes(queryType)) {
      return NextResponse.json(
        { error: 'Valid queryType is required' },
        { status: 400 }
      );
    }

    const id = await saveShare({
      query,
      answer,
      queryType,
      sources: sources || {},
    });

    return NextResponse.json({
      success: true,
      id,
      url: `/share/${id}`,
    });
  } catch (error) {
    console.error('Share creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create share' },
      { status: 500 }
    );
  }
}
