import { put, list, del, head } from '@vercel/blob';
import type { Transcript, TranscriptMetadata } from '@/types/transcript';

const TRANSCRIPT_PREFIX = 'transcripts/';
const AUDIO_PREFIX = 'audio/';

export interface BlobTranscriptInfo {
  url: string;
  pathname: string;
  episodeNumber: number;
  uploadedAt: Date;
}

/**
 * Upload an MP3 file to Vercel Blob storage
 */
export async function uploadAudio(
  file: Blob | Buffer | ArrayBuffer,
  episodeNumber: number
): Promise<string> {
  const pathname = `${AUDIO_PREFIX}episode_${episodeNumber}.mp3`;

  const blob = await put(pathname, file, {
    access: 'public',
    addRandomSuffix: false,
  });

  return blob.url;
}

/**
 * Save a transcript to Vercel Blob storage
 */
export async function saveTranscript(
  transcript: Transcript
): Promise<string> {
  const pathname = `${TRANSCRIPT_PREFIX}episode_${transcript.episode_number}.json`;

  const blob = await put(pathname, JSON.stringify(transcript, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return blob.url;
}

/**
 * Load a transcript from Vercel Blob storage
 */
export async function loadTranscript(
  episodeNumber: number
): Promise<Transcript | null> {
  const pathname = `${TRANSCRIPT_PREFIX}episode_${episodeNumber}.json`;

  try {
    const blobs = await list({ prefix: pathname });
    const match = blobs.blobs.find(b => b.pathname === pathname);

    if (!match) {
      return null;
    }

    const response = await fetch(match.url);
    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Check if a transcript exists in Blob storage
 */
export async function transcriptExists(episodeNumber: number): Promise<boolean> {
  const pathname = `${TRANSCRIPT_PREFIX}episode_${episodeNumber}.json`;

  try {
    const result = await head(pathname);
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Check if audio exists in Blob storage
 */
export async function audioExists(episodeNumber: number): Promise<boolean> {
  const pathname = `${AUDIO_PREFIX}episode_${episodeNumber}.mp3`;

  try {
    const result = await head(pathname);
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Get audio URL from Blob storage
 */
export async function getAudioUrl(episodeNumber: number): Promise<string | null> {
  const pathname = `${AUDIO_PREFIX}episode_${episodeNumber}.mp3`;

  try {
    const result = await head(pathname);
    return result?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * List all transcripts in Blob storage
 */
export async function listBlobTranscripts(): Promise<BlobTranscriptInfo[]> {
  const blobs = await list({ prefix: TRANSCRIPT_PREFIX });

  return blobs.blobs
    .filter(blob => blob.pathname.endsWith('.json'))
    .map(blob => {
      // Extract episode number from pathname like "transcripts/episode_123.json"
      const match = blob.pathname.match(/episode_(\d+)\.json$/);
      const episodeNumber = match ? parseInt(match[1], 10) : 0;

      return {
        url: blob.url,
        pathname: blob.pathname,
        episodeNumber,
        uploadedAt: new Date(blob.uploadedAt),
      };
    })
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/**
 * Delete a transcript from Blob storage
 */
export async function deleteTranscript(episodeNumber: number): Promise<boolean> {
  const pathname = `${TRANSCRIPT_PREFIX}episode_${episodeNumber}.json`;

  try {
    await del(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete audio from Blob storage
 */
export async function deleteAudio(episodeNumber: number): Promise<boolean> {
  const pathname = `${AUDIO_PREFIX}episode_${episodeNumber}.mp3`;

  try {
    await del(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * Store transcription job metadata in Blob storage
 * Used for tracking async transcription jobs
 */
export async function saveTranscriptionJob(
  jobId: string,
  data: {
    episodeNumber: number;
    episodeName: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    audioUrl: string;
    error?: string;
    transcript?: Transcript;
  }
): Promise<string> {
  const pathname = `jobs/${jobId}.json`;

  const blob = await put(pathname, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return blob.url;
}

/**
 * Load transcription job metadata
 */
export async function loadTranscriptionJob(jobId: string): Promise<{
  episodeNumber: number;
  episodeName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl: string;
  error?: string;
  transcript?: Transcript;
} | null> {
  const pathname = `jobs/${jobId}.json`;

  try {
    const blobs = await list({ prefix: pathname });
    const match = blobs.blobs.find(b => b.pathname === pathname);

    if (!match) {
      return null;
    }

    const response = await fetch(match.url);
    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}
