import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { listBlobTranscripts, loadTranscript as loadBlobTranscript } from '@/lib/blob-storage';
import type { Transcript } from '@/types/transcript';

/**
 * GET /api/speakers
 * Returns a list of known speakers from existing transcripts
 * Combines speakers from both filesystem and Blob storage
 */
export async function GET() {
  const speakerCounts = new Map<string, number>();

  // Get speakers from filesystem transcripts
  const transcriptsDir = path.join(process.cwd(), 'transcripts');

  try {
    if (fs.existsSync(transcriptsDir)) {
      const files = fs.readdirSync(transcriptsDir).filter(f => f.endsWith('.json'));

      for (const filename of files) {
        try {
          const filePath = path.join(transcriptsDir, filename);
          const content: Transcript = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

          for (const dialogue of content.dialogues || []) {
            const name = dialogue.name.trim();
            // Skip generic speaker labels
            if (name && !name.match(/^(Speaker\s*)?[A-Z]$/i)) {
              speakerCounts.set(name, (speakerCounts.get(name) || 0) + 1);
            }
          }
        } catch {
          // Skip files that can't be parsed
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  // Get speakers from Blob storage transcripts
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
