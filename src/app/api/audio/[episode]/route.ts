import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAudioUrl } from '@/lib/blob-storage';

function parseEpisodeNumber(episode: string): number {
  const match = episode.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ episode: string }> }
) {
  const { episode } = await params;
  const episodeNumber = parseEpisodeNumber(episode);

  // First try filesystem
  const filePath = path.join(process.cwd(), 'mp3s', `${episode}.mp3`);
  if (fs.existsSync(filePath)) {
    return serveLocalFile(request, filePath);
  }

  // Then try Blob storage
  if (episodeNumber > 0) {
    try {
      const blobUrl = await getAudioUrl(episodeNumber);
      if (blobUrl) {
        // Redirect to Blob URL for audio streaming
        // Vercel Blob handles range requests natively
        return NextResponse.redirect(blobUrl);
      }
    } catch {
      // Blob storage not available
    }
  }

  return NextResponse.json({ error: 'Audio not found' }, { status: 404 });
}

async function serveLocalFile(request: NextRequest, filePath: string) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = request.headers.get('range');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const fileStream = fs.createReadStream(filePath, { start, end });
    const chunks: Uint8Array[] = [];

    for await (const chunk of fileStream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);

    return new NextResponse(buffer, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': 'audio/mpeg',
      },
    });
  }

  const fileBuffer = fs.readFileSync(filePath);

  return new NextResponse(fileBuffer, {
    headers: {
      'Content-Length': fileSize.toString(),
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
    },
  });
}
