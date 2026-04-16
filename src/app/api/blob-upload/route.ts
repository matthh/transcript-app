import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/podreview-auth';

/**
 * POST /api/blob-upload
 * Handle client-side uploads to Vercel Blob
 * This bypasses the serverless function body size limit
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Gate token generation on the original request's bearer credentials.
        if (!checkAuth(request)) {
          throw new Error('Unauthorized');
        }

        // Validate the upload - only allow audio files in the audio/ path
        if (!pathname.startsWith('audio/')) {
          throw new Error('Invalid upload path');
        }

        return {
          allowedContentTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-m4a', 'audio/mp4'],
          maximumSizeInBytes: 500 * 1024 * 1024, // 500MB max
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Audio uploaded:', blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error('Upload error:', error);
    const message = error instanceof Error ? error.message : 'Upload failed';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
