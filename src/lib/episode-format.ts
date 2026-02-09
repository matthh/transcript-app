export function formatEpisodeLabel(season: number, episode: number): string {
  if (episode === 0) {
    return `S${season} Bonus`;
  }
  return `S${season}E${episode}`;
}

export function formatEpisodeDescriptor(season: number, episode: number): string {
  if (episode === 0) {
    return `Season ${season}, Bonus episode`;
  }
  return `Season ${season}, Episode ${episode}`;
}
