import { put } from '@vercel/blob';

const QUERY_LOG_PREFIX = 'query-log/';

export interface QueryLogEntry {
  id: string;
  timestamp: string;
  query: string;
  classification: {
    type: string;
    confidence?: number;
    filters?: Record<string, unknown>;
  };
  sourceCount: number;
  transcriptSourceCount: number;
  metadataSourceCount: number;
  sourceEpisodes: string[];
  answerLength: number;
  latencyMs: number;
  path: string;
  intent?: { type: string; confidence?: string };
  synthesisModel?: string;
  depth?: 'quick' | 'deep';
  routingPath?: 'metadata_fast_path' | 'full_pipeline' | 'fallthrough' | 'agent_search';
  // Populated later if user submits feedback
  rating?: 'good' | 'bad' | null;
  comment?: string;
  // Agent search telemetry (only populated when routingPath='agent_search')
  searchStrategy?: 'rag' | 'agent';
  agentIterationCount?: number;
  agentToolCallCount?: number;
  agentFallbackReason?: null | 'timeout' | 'error_threshold' | 'weak_evidence' | 'model_error';
  agentLatencyBreakdownMs?: {
    route: number;
    tooling: number;
    synthesis: number;
    total: number;
  };
  // Topic vector telemetry
  topicBlobLoaded?: boolean;
  topicHitCount?: number;
  topicOnlyHitCount?: number;
}

export function generateLogId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `ql_${ts}_${rand}`;
}

/**
 * Log a search query and its results to Vercel Blob.
 * Fire-and-forget — errors are logged but don't affect the response.
 */
export async function logQuery(data: Omit<QueryLogEntry, 'id' | 'timestamp'>, preGeneratedId?: string): Promise<string | null> {
  const id = preGeneratedId ?? generateLogId();
  const entry: QueryLogEntry = {
    id,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Organize by year-month for easy browsing
  const month = entry.timestamp.slice(0, 7); // "2026-02"
  const pathname = `${QUERY_LOG_PREFIX}${month}/${id}.json`;

  try {
    await put(pathname, JSON.stringify(entry), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
    return id;
  } catch (err) {
    console.error('Failed to log query:', err);
    return null;
  }
}
