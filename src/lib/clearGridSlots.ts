export function getOccupiedGridSlotIndexes<T>(slots: (T | null | undefined)[]): number[] {
  return slots.flatMap((slot, index) => slot == null ? [] : [index]);
}
