import { NextRequest, NextResponse } from 'next/server';
import { AssemblyAI } from 'assemblyai';
import { saveTranscriptionJob } from '@/lib/blob-storage';

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY || '',
});

/**
 * POST /api/transcribe
 * Start a transcription job for an audio file already uploaded to Blob
 *
 * Body (JSON):
 * - audioUrl: URL of the audio file in Vercel Blob
 * - episodeNumber: number
 * - episodeName: string
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.ASSEMBLYAI_API_KEY) {
      return NextResponse.json(
        { error: 'AssemblyAI API key not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { audioUrl, episodeNumber, episodeName } = body;

    if (!audioUrl) {
      return NextResponse.json(
        { error: 'Audio URL is required' },
        { status: 400 }
      );
    }

    if (!episodeNumber || isNaN(Number(episodeNumber))) {
      return NextResponse.json(
        { error: 'Episode number is required' },
        { status: 400 }
      );
    }

    if (!episodeName) {
      return NextResponse.json(
        { error: 'Episode name is required' },
        { status: 400 }
      );
    }

    // Construct webhook URL
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const webhookUrl = `${baseUrl}/api/transcribe/webhook`;

    // Start transcription with AssemblyAI
    const transcriptResponse = await client.transcripts.submit({
      audio_url: audioUrl,
      speaker_labels: true,
      webhook_url: webhookUrl,
    });

    const jobId = transcriptResponse.id;

    // Save job metadata to Blob storage
    await saveTranscriptionJob(jobId, {
      episodeNumber: Number(episodeNumber),
      episodeName,
      status: 'processing',
      audioUrl,
    });

    return NextResponse.json({
      jobId,
      status: 'processing',
      message: 'Transcription started. Poll /api/transcribe/status/[jobId] for updates.',
    });
  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Transcription failed' },
      { status: 500 }
    );
  }
}
