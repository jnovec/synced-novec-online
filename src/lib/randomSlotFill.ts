export interface RandomSlotCandidate {
  url: string;
}

export interface SlotAssignment<T extends RandomSlotCandidate> {
  index: number;
  video: T;
}

export function planRandomSlotFill<T extends RandomSlotCandidate>(
  slots: (T | null)[],
  candidates: T[],
  visibleSlotCount: number,
  random: () => number = Math.random,
): SlotAssignment<T>[] {
  const visibleCount = Math.min(slots.length, Math.max(0, Math.floor(visibleSlotCount)));
  const occupiedUrls = new Set(slots.filter((slot): slot is T => Boolean(slot)).map(({ url }) => url));
  const availableByUrl = new Map<string, T>();
  for (const candidate of candidates) {
    if (candidate.url && !occupiedUrls.has(candidate.url) && !availableByUrl.has(candidate.url)) {
      availableByUrl.set(candidate.url, candidate);
    }
  }

  const available = [...availableByUrl.values()];
  const assignments: SlotAssignment<T>[] = [];
  for (let index = 0; index < visibleCount && available.length; index += 1) {
    if (slots[index] !== null) continue;
    const sample = random();
    const choice = Math.min(available.length - 1, Math.max(0, Math.floor(sample * available.length)));
    assignments.push({ index, video: available.splice(choice, 1)[0] });
  }
  return assignments;
}
