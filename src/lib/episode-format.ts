export type EpisodeId = number | string;

/**
 * Extract numeric sort key from an episode identifier.
 * Regular episodes: 42 → 42, Bonus episodes: "49b1" → 49.01, "49b2" → 49.02
 */
export function episodeSortKey(episode: EpisodeId): number {
  if (typeof episode === 'number') return episode;
  const match = episode.match(/^(\d+)b(\d+)$/);
  if (match) return parseInt(match[1], 10) + parseInt(match[2], 10) * 0.01;
  return 0;
}

/**
 * Check if an episode identifier represents a bonus episode.
 */
export function isBonusEpisode(episode: EpisodeId): boolean {
  if (typeof episode === 'string') return true;
  return episode === 0;
}

export function formatEpisodeLabel(season: number, episode: EpisodeId): string {
  if (typeof episode === 'string') {
    return `S${season} Bonus`;
  }
  if (episode === 0) {
    return `S${season} Bonus`;
  }
  return `S${season}E${episode}`;
}

export function formatEpisodeDescriptor(season: number, episode: EpisodeId): string {
  if (typeof episode === 'string') {
    return `Season ${season}, Bonus episode`;
  }
  if (episode === 0) {
    return `Season ${season}, Bonus episode`;
  }
  return `Season ${season}, Episode ${episode}`;
}
