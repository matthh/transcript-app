import { NextRequest, NextResponse } from 'next/server';
import { AssemblyAI } from 'assemblyai';
import { loadTranscriptionJob, saveTranscriptionJob, saveTranscript, saveRawTranscript } from '@/lib/blob-storage';
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
 * GET /api/transcribe/status/[jobId]
 * Poll transcription job status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    // First check our stored job metadata
    const job = await loadTranscriptionJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // If already completed or failed, return stored status
    if (job.status === 'completed' || job.status === 'failed') {
      return NextResponse.json({
        status: job.status,
        error: job.error,
        transcript: job.status === 'completed' ? job.transcript : undefined,
      });
    }

    // Poll AssemblyAI for current status
    const transcriptResult = await client.transcripts.get(jobId);

    if (transcriptResult.status === 'error') {
      // Update job status
      await saveTranscriptionJob(jobId, {
        ...job,
        status: 'failed',
        error: transcriptResult.error || 'Transcription failed',
      });

      return NextResponse.json({
        status: 'failed',
        error: transcriptResult.error || 'Transcription failed',
      });
    }

    if (transcriptResult.status === 'completed') {
      // Process and save the transcript
      const utterances = transcriptResult.utterances || [];

      const dialogues: DialogueEntry[] = utterances.map((utterance) => ({
        name: utterance.speaker,
        timestamp: formatTimestamp(utterance.start),
        text: utterance.text,
      }));

      const transcript: Transcript = {
        episode_number: job.episodeNumber,
        episode_name: job.episodeName,
        dialogues,
      };

      // Save raw + mapped transcript to Blob storage
      await saveRawTranscript(transcript);
      await saveTranscript(transcript);

      // Update job status
      await saveTranscriptionJob(jobId, {
        ...job,
        status: 'completed',
        transcript,
      });

      return NextResponse.json({
        status: 'completed',
        transcript,
      });
    }

    // Still processing - return additional info for progress display
    return NextResponse.json({
      status: 'processing',
      assemblyAiStatus: transcriptResult.status,
      audioDuration: transcriptResult.audio_duration || null,
      wordCount: transcriptResult.words?.length || null,
    });
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Status check failed' },
      { status: 500 }
    );
  }
}
