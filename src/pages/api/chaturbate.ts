import { roomPageOffset } from '@/lib/channelCatalog';
import type { NextApiRequest, NextApiResponse } from 'next';

const ROOMLIST_URL = 'https://chaturbate.com/api/ts/roomlist/room-list/';
const DEFAULT_PAGE = 1;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pageRaw = Number(req.query.page ?? DEFAULT_PAGE);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 20) : DEFAULT_PAGE;

  try {
    console.log('[chaturbate api] popular rooms request', { page });
    const roomlist = await fetchRoomPage(page);
    const rooms = roomlist.rooms
      .filter((room) => room.username && Number.isFinite(Number(room.num_users)))
      .sort((a, b) => Number(b.num_users) - Number(a.num_users));
    return res.status(200).json({
      rooms: rooms.map((room) => ({
        name: room.username,
        location: `${room.num_users ?? 0} viewers · ${genderLabel(room.gender)}`,
        url: `https://chaturbate.com/${room.username}/`,
        logo: room.img,
        viewers: room.num_users ?? 0,
        genderLabel: genderLabel(room.gender),
      })),
      total_count: roomlist.total_count ?? rooms.length,
      page,
    });
  } catch (error) {
    console.error('Chaturbate room list fetch failed', error);
    return res.status(500).json({ error: 'roomlist_fetch_failed' });
  }
}

async function fetchRoomPage(page: number): Promise<RoomlistPage> {
  // This endpoint is used by Chaturbate's dynamically rendered homepage.
  // It paginates with a 40-room offset; a `page` query is ignored by the provider.
  const url = `${ROOMLIST_URL}?offset=${roomPageOffset(page)}`;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0',
      },
    });

    if (response.ok) {
      return (await response.json()) as RoomlistPage;
    }

    if (response.status === 429 || response.status >= 500) {
      await sleep(1000 * (attempt + 1));
      continue;
    }

    throw new Error(`roomlist page ${page} failed: HTTP ${response.status}`);
  }

  throw new Error(`roomlist page ${page} failed after retries`);
}

function genderLabel(gender: string): string {
  if (gender === 'f') return 'female';
  if (gender === 'm') return 'male';
  if (gender === 'c') return 'couple';
  if (gender === 't') return 'trans';
  return 'live';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RoomlistPage {
  rooms: RoomlistRoom[];
  total_count?: number;
  all_rooms_count?: number;
}

interface RoomlistRoom {
  username: string;
  location: string;
  current_show: string;
  img: string;
  num_users: number;
  gender: string;
}
