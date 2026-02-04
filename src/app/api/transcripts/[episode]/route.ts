import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Transcript } from '@/types/transcript';
import {
  loadTranscript as loadBlobTranscript,
  saveTranscript as saveBlobTranscript,
  deleteTranscript as deleteBlobTranscript,
} from '@/lib/blob-storage';

function parseEpisodeNumber(episode: string): number {
  // Handle formats like "episode_123" or just "123"
  const match = episode.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ episode: string }> }
) {
  const { episode } = await params;
  const episodeNumber = parseEpisodeNumber(episode);

  // First try filesystem (for existing transcripts)
  const filePath = path.join(process.cwd(), 'transcripts', `${episode}.json`);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const transcript: Transcript = JSON.parse(content);
    return NextResponse.json(transcript);
  }

  // Then try Blob storage (for newly uploaded transcripts)
  if (episodeNumber > 0) {
    try {
      const blobTranscript = await loadBlobTranscript(episodeNumber);
      if (blobTranscript) {
        return NextResponse.json(blobTranscript);
      }
    } catch {
      // Blob storage not available or transcript not found
    }
  }

  return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ episode: string }> }
) {
  const { episode } = await params;
  const transcript: Transcript = await request.json();

  // Try to save to filesystem first (for local development)
  const filePath = path.join(process.cwd(), 'transcripts', `${episode}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(transcript, null, 2), 'utf-8');
    return NextResponse.json({ success: true, storage: 'filesystem' });
  } catch {
    // Filesystem is read-only (production), save to Blob storage
  }

  // Save to Blob storage
  try {
    await saveBlobTranscript(transcript);
    return NextResponse.json({ success: true, storage: 'blob' });
  } catch (error) {
    console.error('Failed to save transcript:', error);
    return NextResponse.json(
      { error: 'Failed to save transcript' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ episode: string }> }
) {
  const { episode } = await params;
  const episodeNumber = parseEpisodeNumber(episode);

  if (episodeNumber === 0) {
    return NextResponse.json({ error: 'Invalid episode number' }, { status: 400 });
  }

  const deleted: string[] = [];
  const errors: string[] = [];

  // Try to delete from filesystem
  const filePath = path.join(process.cwd(), 'transcripts', `episode_${episodeNumber}.json`);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      deleted.push('filesystem');
    } catch (err) {
      errors.push(`filesystem: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  // Try to delete from Blob storage
  try {
    const success = await deleteBlobTranscript(episodeNumber);
    if (success) {
      deleted.push('blob');
    }
  } catch (err) {
    errors.push(`blob: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  if (deleted.length === 0 && errors.length === 0) {
    return NextResponse.json(
      { message: 'No transcript found to delete', episode: episodeNumber },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    episode: episodeNumber,
    deleted,
    errors: errors.length > 0 ? errors : undefined,
  });
}
