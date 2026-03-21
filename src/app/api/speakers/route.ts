import { NextResponse } from 'next/server';
import { listBlobTranscripts, loadTranscript as loadBlobTranscript } from '@/lib/blob-storage';

/**
 * GET /api/speakers
 * Returns a list of known speakers from existing transcripts
 */
export async function GET() {
  const speakerCounts = new Map<string, number>();

  try {
    const blobTranscripts = await listBlobTranscripts();

    for (const blobInfo of blobTranscripts) {
      try {
        const transcript = await loadBlobTranscript(blobInfo.episodeNumber);
        if (transcript) {
          for (const dialogue of transcript.dialogues || []) {
            const name = dialogue.name.trim();
            // Skip generic speaker labels
            if (name && !name.match(/^(Speaker\s*)?[A-Z]$/i)) {
              speakerCounts.set(name, (speakerCounts.get(name) || 0) + 1);
            }
          }
        }
      } catch {
        // Skip transcripts that can't be loaded
      }
    }
  } catch {
    // Blob storage not available or empty
  }

  // Sort by frequency (most common first)
  const speakers = Array.from(speakerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return NextResponse.json({ speakers });
}
