import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { TranscriptMetadata } from '@/types/transcript';
import { listBlobTranscripts, loadTranscript as loadBlobTranscript, audioExists } from '@/lib/blob-storage';

export async function GET() {
  const transcriptsDir = path.join(process.cwd(), 'transcripts');
  const mp3sDir = path.join(process.cwd(), 'mp3s');

  const transcripts: TranscriptMetadata[] = [];
  const seenEpisodes = new Set<number>();

  // Get transcripts from filesystem
  try {
    if (fs.existsSync(transcriptsDir)) {
      const files = fs.readdirSync(transcriptsDir).filter(f => f.endsWith('.json'));

      for (const filename of files) {
        try {
          const filePath = path.join(transcriptsDir, filename);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

          const baseName = filename.replace('.json', '');
          const mp3Path = path.join(mp3sDir, `${baseName}.mp3`);
          const hasAudio = fs.existsSync(mp3Path);

          const episodeNumber = content.episode_number || 0;
          seenEpisodes.add(episodeNumber);

          transcripts.push({
            filename: baseName,
            episode_number: episodeNumber,
            episode_name: content.episode_name || baseName,
            dialogueCount: content.dialogues?.length || 0,
            hasAudio,
          });
        } catch {
          // Skip files that can't be parsed
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  // Get transcripts from Blob storage
  try {
    const blobTranscripts = await listBlobTranscripts();

    for (const blobInfo of blobTranscripts) {
      // Skip if we already have this episode from filesystem
      if (seenEpisodes.has(blobInfo.episodeNumber)) {
        continue;
      }

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
