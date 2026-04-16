import { NextRequest, NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import type { CleanupChange } from '@/app/api/cleanup-transcript/route';
import { checkAuth } from '@/lib/podreview-auth';

const FEEDBACK_PREFIX = 'cleanup-feedback/';

export interface CleanupFeedbackEntry {
  episodeNumber: number;
  episodeName: string;
  timestamp: string;
  decisions: {
    change: CleanupChange;
    accepted: boolean;
  }[];
}

/**
 * POST — log cleanup accept/reject decisions
 */
export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { episodeNumber, episodeName, decisions } = body;

    if (!episodeNumber || !decisions?.length) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    const entry: CleanupFeedbackEntry = {
      episodeNumber,
      episodeName,
      timestamp: new Date().toISOString(),
      decisions,
    };

    const pathname = `${FEEDBACK_PREFIX}ep${episodeNumber}_${Date.now()}.json`;
    await put(pathname, JSON.stringify(entry, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Cleanup feedback error:', err);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}

/**
 * GET — query cleanup feedback
 *
 * Query params:
 *   ?type=sample|spelling|speaker|voicemailer — filter by change type
 *   ?accepted=true|false — filter by decision
 *   ?episode=298 — filter by episode number
 *   ?summary=true — return aggregate stats instead of raw entries
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type');
    const acceptedFilter = searchParams.get('accepted');
    const episodeFilter = searchParams.get('episode');
    const summary = searchParams.get('summary') === 'true';

    // Load all feedback entries from Blob
    const blobs = await list({ prefix: FEEDBACK_PREFIX });
    const entries: CleanupFeedbackEntry[] = [];

    for (const blob of blobs.blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      try {
        const resp = await fetch(blob.url, { cache: 'no-store' });
        if (resp.ok) {
          entries.push(await resp.json());
        }
      } catch {
        // skip corrupt entries
      }
    }

    // Flatten all decisions with episode context
    let allDecisions = entries.flatMap(e =>
      e.decisions.map(d => ({
        episodeNumber: e.episodeNumber,
        episodeName: e.episodeName,
        timestamp: e.timestamp,
        ...d,
      })),
    );

    // Apply filters
    if (typeFilter) {
      allDecisions = allDecisions.filter(d => d.change.type === typeFilter);
    }
    if (acceptedFilter !== null) {
      const wantAccepted = acceptedFilter === 'true';
      allDecisions = allDecisions.filter(d => d.accepted === wantAccepted);
    }
    if (episodeFilter) {
      const epNum = parseInt(episodeFilter, 10);
      allDecisions = allDecisions.filter(d => d.episodeNumber === epNum);
    }

    if (summary) {
      // Aggregate stats
      const stats: Record<string, { proposed: number; accepted: number; rejected: number }> = {};
      for (const d of allDecisions) {
        const type = d.change.type;
        if (!stats[type]) stats[type] = { proposed: 0, accepted: 0, rejected: 0 };
        stats[type].proposed++;
        if (d.accepted) stats[type].accepted++;
        else stats[type].rejected++;
      }

      // Top rejected patterns (to improve the prompt)
      const rejected = allDecisions
        .filter(d => !d.accepted)
        .map(d => ({
          type: d.change.type,
          field: d.change.field,
          oldValue: d.change.oldValue,
          newValue: d.change.newValue,
          reason: d.change.reason,
          episode: d.episodeName,
        }));

      return NextResponse.json({
        totalRuns: entries.length,
        totalDecisions: allDecisions.length,
        stats,
        rejectedExamples: rejected.slice(0, 50),
      });
    }

    return NextResponse.json({
      total: allDecisions.length,
      decisions: allDecisions,
    });
  } catch (err) {
    console.error('Cleanup feedback query error:', err);
    return NextResponse.json({ error: 'Failed to query feedback' }, { status: 500 });
  }
}
