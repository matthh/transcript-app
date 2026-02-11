const NOTABLE_FILM_PATTERNS: RegExp[] = [
  /\b(?:notable|interesting|key|best|memorable)\s+moments?\b.*?(?:from|for|in|of)\s+(?:the\s+)?(.+?)(?:\s+episode\b|$)/i,
  /\b(?:highlights?)\b.*?(?:from|for|in|of)\s+(?:the\s+)?(.+?)(?:\s+episode\b|$)/i,
  /\b(?:most\s+)?(?:interesting|key|best|memorable)\s+moments?\s+in\s+(?:the\s+)?(.+?)\s+episode\b/i,
  /\bnotable moments?\b\s+(?:for|in)?\s*(.+)$/i,
];

export function extractNotableMomentsFilm(query: string): string | null {
  const normalized = query.replace(/[’‘]/g, "'").trim();
  for (const pattern of NOTABLE_FILM_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].replace(/\s+episode\b/i, '').trim();
      if (!candidate) continue;
      if (/\bepisode\b/i.test(candidate)) continue;
      return candidate;
    }
  }
  return null;
}
