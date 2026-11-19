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

export function bufferWindow(ranges: TimeRanges, position: number) {
  if (!ranges.length) return null;
  let i = ranges.length - 1;
  for (let j = 0; j < ranges.length; j++) {
    if (position >= ranges.start(j) - 0.1 && position <= ranges.end(j)) { i = j; break; }
  }
  const end = ranges.end(i);
  return { start: Math.max(ranges.start(i), end - 60), end };
}

export const isCacheOnlySlot = (fullscreen: number | null, index: number) => fullscreen !== null && fullscreen !== index;
