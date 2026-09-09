import type { DiscoveredChannel } from './sourceDiscovery.ts';

interface ChaturbateRoom {
  username?: unknown;
  display_name?: unknown;
  display_age?: unknown;
  current_show?: unknown;
  img?: unknown;
  num_users?: unknown;
  gender?: unknown;
  location?: unknown;
}

interface ChaturbateListing {
  rooms?: unknown;
}

export const isChaturbateUrl = (url: URL): boolean => /(^|\.)chaturbate\.com$/i.test(url.hostname);

export const buildChaturbateListingUrl = (sourceUrl: URL): URL => {
  const listingUrl = new URL('/api/ts/roomlist/room-list/', sourceUrl.origin);
  listingUrl.searchParams.set('enable_recommendations', 'false');
  listingUrl.searchParams.set('limit', '90');
  listingUrl.searchParams.set('offset', '0');

  const gender = chaturbateGender(sourceUrl);
  if (gender) listingUrl.searchParams.set('genders', gender);
  return listingUrl;
};

export const parseChaturbateListing = (payload: unknown, sourceUrl: URL): DiscoveredChannel[] => {
  if (!payload || typeof payload !== 'object') return [];
  const rooms = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as ChaturbateListing).rooms)
      ? (payload as ChaturbateListing).rooms
      : (payload as { data?: ChaturbateListing }).data?.rooms;
  if (!Array.isArray(rooms)) return [];

  const channels: DiscoveredChannel[] = [];
  const seen = new Set<string>();

  for (const value of rooms) {
    if (!value || typeof value !== 'object') continue;
    const room = value as ChaturbateRoom;
    const username = cleanUsername(room.username);
    if (!username || seen.has(username.toLowerCase())) continue;

    const show = stringValue(room.current_show).toLowerCase();
    if (show && show !== 'public') continue;

    seen.add(username.toLowerCase());
    const viewers = finiteNumber(room.num_users) ?? 0;
    const gender = genderLabel(stringValue(room.gender));
    const location = stringValue(room.location) || gender;
    const displayName = stringValue(room.display_name) || username;
    const age = finiteNumber(room.display_age);

    channels.push({
      name: age ? `${displayName} (${age})` : displayName,
      location: `${viewers} viewers · ${location}`,
      url: new URL(`/${encodeURIComponent(username)}/`, sourceUrl.origin).toString(),
      logo: normalizeImage(room.img, sourceUrl),
      viewers,
    });
  }

  return channels.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
};

const chaturbateGender = (url: URL): string => {
  const path = url.pathname.toLowerCase();
  if (/\/(?:female-cams|women)(?:\/|$)/.test(path)) return 'f';
  if (/\/(?:male-cams|men)(?:\/|$)/.test(path)) return 'm';
  if (/\/(?:couple-cams|couples)(?:\/|$)/.test(path)) return 'c';
  if (/\/(?:trans-cams|trans)(?:\/|$)/.test(path)) return 't';
  return '';
};

const genderLabel = (gender: string): string => {
  if (gender === 'f') return 'female';
  if (gender === 'm') return 'male';
  if (gender === 'c') return 'couple';
  if (gender === 't') return 'trans';
  return 'live';
};

const normalizeImage = (value: unknown, sourceUrl: URL): string => {
  const image = stringValue(value);
  if (!image) return '';
  try {
    const url = new URL(image.startsWith('//') ? `https:${image}` : image, sourceUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
};

const cleanUsername = (value: unknown): string | null => {
  const username = stringValue(value);
  return /^[a-z0-9_-]{1,64}$/i.test(username) ? username : null;
};

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const finiteNumber = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};
