import { NextRequest, NextResponse } from 'next/server';

const GITHUB_REPO = 'jbennygold/transcript-app';
const WORKFLOW_FILE = 'ingest-episode.yml';

/**
 * POST /api/rebuild
 * Trigger the ingest-episode GitHub Actions workflow for a specific episode.
 * Body: { episode: number }
 */
export async function POST(request: NextRequest) {
  const githubToken = process.env.GITHUB_PAT;

  if (!githubToken) {
    return NextResponse.json(
      { error: 'GITHUB_PAT not configured' },
      { status: 500 }
    );
  }

  let episode: string;
  try {
    const body = await request.json();
    episode = String(body.episode);
    if (!episode || episode === 'undefined') {
      return NextResponse.json(
        { error: 'Missing episode number in request body' },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body — expected { episode: number }' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref: 'master',
          inputs: { episode },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API returned ${response.status}: ${text}`);
    }

    return NextResponse.json({
      success: true,
      message: `Ingest workflow triggered for episode ${episode}`,
    });
  } catch (error) {
    console.error('Rebuild trigger error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger ingest workflow' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/rebuild
 * Check if rebuild is configured
 */
export async function GET() {
  const isConfigured = !!process.env.GITHUB_PAT;

  return NextResponse.json({
    configured: isConfigured,
    message: isConfigured
      ? 'Ingest workflow trigger is configured'
      : 'GITHUB_PAT not set',
  });
}
