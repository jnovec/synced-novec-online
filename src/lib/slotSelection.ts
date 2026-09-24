export const findFirstEmptyVisibleSlot = <T>(slots: Array<T | null | undefined>, visibleSlotCount: number): number => {
  const visibleCount = Math.max(0, Math.min(slots.length, Math.floor(visibleSlotCount)));
  return slots.slice(0, visibleCount).findIndex((slot) => slot == null);
};
