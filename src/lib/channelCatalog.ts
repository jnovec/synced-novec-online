interface CatalogRoom {
  name: string;
  url: string;
  viewers?: number;
}

export const roomPageOffset = (page: number): number => (Math.max(1, Math.floor(page)) - 1) * 40;

export const mergeCurrentRooms = <T extends CatalogRoom>(pages: T[][]): T[] => {
  const byUrl = new Map<string, T>();

  for (const room of pages.flat()) {
    const existing = byUrl.get(room.url);
    if (!existing || (room.viewers ?? 0) > (existing.viewers ?? 0)) byUrl.set(room.url, room);
  }

  return Array.from(byUrl.values()).sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
};
