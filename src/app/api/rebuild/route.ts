import { NextResponse } from 'next/server';

/**
 * POST /api/rebuild
 * Trigger a Vercel deploy hook to rebuild the site
 * This re-runs ingest.ts and bundle-data.ts to update the vector store
 */
export async function POST() {
  const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;

  if (!deployHookUrl) {
    return NextResponse.json(
      { error: 'VERCEL_DEPLOY_HOOK_URL not configured' },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(deployHookUrl, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Deploy hook returned ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      message: 'Rebuild triggered successfully',
      job: data.job,
    });
  } catch (error) {
    console.error('Rebuild trigger error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger rebuild' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/rebuild
 * Check if rebuild is configured
 */
export async function GET() {
  const isConfigured = !!process.env.VERCEL_DEPLOY_HOOK_URL;

  return NextResponse.json({
    configured: isConfigured,
    message: isConfigured
      ? 'Rebuild hook is configured'
      : 'VERCEL_DEPLOY_HOOK_URL not set',
  });
}
