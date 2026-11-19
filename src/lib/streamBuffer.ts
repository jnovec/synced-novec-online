export function bufferedAhead(ranges: TimeRanges, position: number): number {
  for (let i = 0; i < ranges.length; i++) {
    if (position >= ranges.start(i) - 0.1 && position < ranges.end(i)) {
      return ranges.end(i) - Math.max(position, ranges.start(i));
    }
  }
  return 0;
}

export function startupBufferReady(ranges: TimeRanges, position: number, duration: number): boolean {
  const ahead = bufferedAhead(ranges, position);
  const remaining = duration - position;
  return ahead >= 4 || (Number.isFinite(remaining) && ahead > 0 && ahead >= remaining - 0.1);
}
