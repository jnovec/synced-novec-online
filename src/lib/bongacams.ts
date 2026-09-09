import type { DiscoveredChannel } from './sourceDiscovery.ts';

interface BongaModel {
  username?: unknown;
  display_name?: unknown;
  topic?: unknown;
  thumb_image?: unknown;
  profile_image?: unknown;
  viewers?: unknown;
  members_count?: unknown;
  gender?: unknown;
  country?: unknown;
  room?: unknown;
  esid?: unknown;
}

interface BongaListing {
  models?: unknown;
}

export const isBongaCamsUrl = (url: URL): boolean =>
  /(^|\.)bongacams\d*\.com$/i.test(url.hostname);

export const buildBongaListingUrl = (sourceUrl: URL): URL => {
  const listingUrl = new URL('/tools/listing_v3.php', sourceUrl.origin);
  listingUrl.searchParams.set('livetab', bongaLiveTab(sourceUrl));
  listingUrl.searchParams.set('online_only', 'true');
  listingUrl.searchParams.set('offset', '0');
  listingUrl.searchParams.set('can_pin_models', 'false');
  listingUrl.searchParams.set('limit', '200');
  return listingUrl;
};

export const parseBongaListing = (payload: unknown, sourceUrl: URL): DiscoveredChannel[] => {
  if (!payload || typeof payload !== 'object') return [];
  const models = (payload as BongaListing).models;
  if (!Array.isArray(models)) return [];

  const seen = new Set<string>();
  const channels: DiscoveredChannel[] = [];

  for (const value of models) {
    if (!value || typeof value !== 'object') continue;
    const model = value as BongaModel;
    const username = cleanUsername(model.username);
    if (!username || seen.has(username.toLowerCase())) continue;
    if (typeof model.room === 'string' && model.room && model.room !== 'public') continue;

    seen.add(username.toLowerCase());
    const viewers = finiteNumber(model.viewers) ?? finiteNumber(model.members_count);
    const detail = stringValue(model.gender) || stringValue(model.country) || 'live';
    const playbackUrl = buildBongaPlaybackUrl(model.esid, username);

    channels.push({
      name: stringValue(model.display_name) || stringValue(model.topic) || username,
      location: `${viewers ?? 0} viewers · ${detail}`,
      url: new URL(`/${encodeURIComponent(username)}`, sourceUrl.origin).toString(),
      logo: normalizeBongaImage(model.thumb_image, sourceUrl) || normalizeBongaImage(model.profile_image, sourceUrl),
      ...(playbackUrl ? { playbackUrl } : {}),
      viewers: viewers ?? 0,
    });
  }

  return channels.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
};

export const extractBongaUsername = (url: URL): string | null => {
  if (!isBongaCamsUrl(url)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const candidate = parts[0]?.toLowerCase() === 'profile' ? parts[1] : parts[0];
  return cleanUsername(candidate);
};

export const buildBongaRoomDataUrl = (sourceUrl: URL, username: string): URL => {
  const roomUrl = new URL('/tools/amf.php', sourceUrl.origin);
  roomUrl.searchParams.set('method', 'getRoomData');
  roomUrl.searchParams.append('args[]', username);
  roomUrl.searchParams.append('args[]', 'false');
  return roomUrl;
};

export const parseBongaRoomStream = (payload: unknown, username: string): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as {
    status?: unknown;
    performerData?: { isOnline?: unknown; showType?: unknown };
    localData?: { videoServerUrl?: unknown };
  };
  if (data.status !== 'success' || data.performerData?.isOnline === false) return null;
  if (typeof data.performerData?.showType === 'string' && data.performerData.showType !== 'public') return null;

  const rawHost = stringValue(data.localData?.videoServerUrl);
  if (!rawHost) return null;
  try {
    const host = new URL(rawHost.startsWith('//') ? `https:${rawHost}` : rawHost);
    if (host.protocol !== 'https:' || !/(^|\.)bcvcdn\.com$/i.test(host.hostname)) return null;
    const safeUsername = encodeURIComponent(username);
    return `${host.origin}/hls/stream_${safeUsername}/playlist.m3u8`;
  } catch {
    return null;
  }
};

const buildBongaPlaybackUrl = (rawEsid: unknown, username: string): string | null => {
  const esid = stringValue(rawEsid);
  if (!/^[a-z0-9-]{1,80}$/i.test(esid)) return null;
  const safeUsername = encodeURIComponent(username);
  return `https://${esid}.bcvcdn.com/hls/stream_${safeUsername}/public-aac/stream_${safeUsername}/chunks.m3u8`;
};

const normalizeBongaImage = (rawImage: unknown, sourceUrl: URL): string => {
  const value = stringValue(rawImage).replace('{ext}', 'webp');
  if (!value) return '';
  try {
    const imageUrl = new URL(value.startsWith('//') ? `https:${value}` : value, sourceUrl);
    return ['http:', 'https:'].includes(imageUrl.protocol) ? imageUrl.toString() : '';
  } catch {
    return '';
  }
};

const bongaLiveTab = (url: URL): string => {
  const firstPart = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  if (firstPart === 'male' || firstPart === 'couples' || firstPart === 'transsexual' || firstPart === 'female') {
    return firstPart;
  }
  return 'all';
};

const cleanUsername = (value: unknown): string | null => {
  const username = stringValue(value).trim();
  return /^[a-z0-9_.-]{1,80}$/i.test(username) ? username : null;
};

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const finiteNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};
