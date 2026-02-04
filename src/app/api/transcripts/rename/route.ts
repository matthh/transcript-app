import { NextRequest, NextResponse } from 'next/server';
import { renameTranscript } from '@/lib/blob-storage';

/**
 * POST /api/transcripts/rename
 * Rename a transcript by changing its episode number
 *
 * Body (JSON):
 * - from: number - current episode number
 * - to: number - new episode number
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { from, to } = body;

    if (!from || isNaN(Number(from))) {
      return NextResponse.json(
        { error: 'Valid "from" episode number is required' },
        { status: 400 }
      );
    }

    if (!to || isNaN(Number(to))) {
      return NextResponse.json(
        { error: 'Valid "to" episode number is required' },
        { status: 400 }
      );
    }

    const fromNum = Number(from);
    const toNum = Number(to);

    if (fromNum === toNum) {
      return NextResponse.json(
        { error: 'Source and destination episode numbers must be different' },
        { status: 400 }
      );
    }

    const result = await renameTranscript(fromNum, toNum);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Transcript renamed from episode_${fromNum} to episode_${toNum}`,
    });
  } catch (error) {
    console.error('Rename transcript error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Rename failed' },
      { status: 500 }
    );
  }
}
