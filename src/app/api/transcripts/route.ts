import { NextResponse } from 'next/server';
import { TranscriptMetadata } from '@/types/transcript';
import { listBlobTranscripts, loadTranscript as loadBlobTranscript, audioExists } from '@/lib/blob-storage';

export async function GET() {
  const transcripts: TranscriptMetadata[] = [];

  // Get transcripts from Blob storage
  try {
    const blobTranscripts = await listBlobTranscripts();

    for (const blobInfo of blobTranscripts) {
      try {
        const transcript = await loadBlobTranscript(blobInfo.episodeNumber);
        if (transcript) {
          const hasAudio = await audioExists(blobInfo.episodeNumber);

          transcripts.push({
            filename: `episode_${blobInfo.episodeNumber}`,
            episode_number: blobInfo.episodeNumber,
            episode_name: transcript.episode_name,
            dialogueCount: transcript.dialogues?.length || 0,
            hasAudio,
          });
        }
      } catch {
        // Skip transcripts that can't be loaded
      }
    }
  } catch {
    // Blob storage not available
  }

  // Sort by episode number
  transcripts.sort((a, b) => a.episode_number - b.episode_number);

  return NextResponse.json(transcripts);
}
