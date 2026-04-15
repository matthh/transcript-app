import { timingSafeEqual } from 'crypto';

export type AuthResult =
  | { ok: true; keyId: string }
  | { ok: false; reason: 'missing' | 'invalid' };

/**
 * EH_EXTERNAL_KEYS format: comma-separated `keyId:secret` pairs.
 * Example: "explore:eh_live_abc123,partnerx:eh_live_def456"
 */
function parseAllowlist(raw: string | undefined): Array<{ keyId: string; secret: string }> {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(':');
      if (idx <= 0 || idx === entry.length - 1) return null;
      return { keyId: entry.slice(0, idx), secret: entry.slice(idx + 1) };
    })
    .filter((x): x is { keyId: string; secret: string } => x !== null);
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function validateExternalKey(header: string | null): AuthResult {
  if (!header) return { ok: false, reason: 'missing' };
  const allowlist = parseAllowlist(process.env.EH_EXTERNAL_KEYS);
  if (allowlist.length === 0) return { ok: false, reason: 'invalid' };
  for (const { keyId, secret } of allowlist) {
    if (constantTimeEqual(header, secret)) return { ok: true, keyId };
  }
  return { ok: false, reason: 'invalid' };
}
