export interface RandomSlotReplacement<T extends { url: string }> {
  index: number;
  video: T;
}

export function planRandomSlotReplacement<T extends { url: string }>(
  slots: (T | null)[],
  candidates: T[],
  selectedIndexes: number[],
  visibleSlotCount: number,
  random: () => number = Math.random,
): RandomSlotReplacement<T>[] {
  const visibleCount = Math.min(slots.length, Math.max(0, Math.floor(visibleSlotCount)));
  const protectedIndexes = new Set(selectedIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < visibleCount));
  const usedUrls = new Set(slots.slice(0, visibleCount).filter((slot): slot is T => Boolean(slot)).map(({ url }) => url));
  const availableByUrl = new Map<string, T>();
  for (const candidate of candidates) {
    if (candidate.url && !usedUrls.has(candidate.url) && !availableByUrl.has(candidate.url)) availableByUrl.set(candidate.url, candidate);
  }
  const available = [...availableByUrl.values()];
  const assignments: RandomSlotReplacement<T>[] = [];
  for (let index = 0; index < visibleCount && available.length; index += 1) {
    if (protectedIndexes.has(index)) continue;
    const choice = Math.min(available.length - 1, Math.max(0, Math.floor(random() * available.length)));
    assignments.push({ index, video: available.splice(choice, 1)[0] });
  }
  return assignments;
}
