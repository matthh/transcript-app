import { NextRequest, NextResponse } from 'next/server';
import { AssemblyAI } from 'assemblyai';
import { loadTranscriptionJob, saveTranscriptionJob, saveTranscript } from '@/lib/blob-storage';
import type { Transcript, DialogueEntry } from '@/types/transcript';

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY || '',
});

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * POST /api/transcribe/webhook
 * Webhook handler for AssemblyAI transcription completion
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transcript_id, status } = body;

    if (!transcript_id) {
      return NextResponse.json({ error: 'Missing transcript_id' }, { status: 400 });
    }

    // Load job metadata
    const job = await loadTranscriptionJob(transcript_id);
    if (!job) {
      console.error(`Job not found for transcript_id: ${transcript_id}`);
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (status === 'error') {
      // Update job status to failed
      await saveTranscriptionJob(transcript_id, {
        ...job,
        status: 'failed',
        error: body.error || 'Transcription failed',
      });

      return NextResponse.json({ received: true });
    }

    if (status !== 'completed') {
      // Ignore other status updates
      return NextResponse.json({ received: true });
    }

    // Fetch the full transcript from AssemblyAI
    const transcriptResult = await client.transcripts.get(transcript_id);

    if (transcriptResult.status !== 'completed') {
      return NextResponse.json({ error: 'Transcript not completed' }, { status: 400 });
    }

    const utterances = transcriptResult.utterances || [];

    // Convert to our transcript format (with speaker labels like "Speaker A", "Speaker B")
    const dialogues: DialogueEntry[] = utterances.map((utterance) => ({
      name: utterance.speaker, // Will be like "A", "B", etc.
      timestamp: formatTimestamp(utterance.start),
      text: utterance.text,
    }));

    const transcript: Transcript = {
      episode_number: job.episodeNumber,
      episode_name: job.episodeName,
      dialogues,
    };

    // Save transcript to Blob storage
    await saveTranscript(transcript);

    // Update job status to completed
    await saveTranscriptionJob(transcript_id, {
      ...job,
      status: 'completed',
      transcript,
    });

    return NextResponse.json({ received: true, status: 'completed' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
