/**
 * Convert timestamp string (e.g., "3:45" or "1:23:45") to seconds
 */
export function timestampToSeconds(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 2) {
    // mm:ss
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // hh:mm:ss
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * Convert seconds to timestamp string (e.g., 225 -> "3:45")
 */
export function secondsToTimestamp(secs: number): string {
  const totalSeconds = Math.floor(secs);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
