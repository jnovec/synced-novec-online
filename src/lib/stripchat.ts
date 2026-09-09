import type { DiscoveredChannel } from './sourceDiscovery.ts';

interface StripchatListing {
  models?: unknown;
}

export const isStripchatUrl = (url: URL): boolean => /(^|\.)stripchat\.com$/i.test(url.hostname);

export const buildStripchatListingUrl = (sourceUrl: URL): URL =>
  new URL('/api/front/v2/models/get-list', sourceUrl.origin);

export const buildStripchatLegacyListingUrl = (sourceUrl: URL): URL => {
  const url = new URL('/api/front/models', sourceUrl.origin);
  for (const [key, value] of Object.entries({
    removeShows: 'false', recInFeatured: 'false', limit: '80', offset: '0',
    filterGroupTags: '', sortBy: 'stripRanking', parentTag: '', nic: 'true',
    byw: 'false', rcmGrp: 'A', rbCnGr: 'true', iem: 'true', decMb: 'true',
    ctryTop: 'true', primaryTag: '',
  })) url.searchParams.set(key, value);
  return url;
};

export const buildStripchatListingBody = (): string =>
  JSON.stringify({
    primaryTag: 'girls',
    limit: 60,
    topLimit: 60,
    blockId: 'topStreamsModels',
    blockUrl: '',
    excludeModelIds: [],
  });

export const parseStripchatListing = (payload: unknown, sourceUrl: URL): DiscoveredChannel[] => {
  if (!payload || typeof payload !== 'object') return [];
  const raw = payload as StripchatListing & { items?: unknown; tops?: unknown };
  let models: unknown[] = [];
  if (Array.isArray(raw.models)) {
    models = raw.models;
  } else if (Array.isArray(raw.items)) {
    models = raw.items.map(unwrapModel);
  } else if (Array.isArray(raw.tops)) {
    models = raw.tops.flatMap((top) => {
      if (!top || typeof top !== 'object' || !Array.isArray((top as { winners?: unknown }).winners)) return [];
      return (top as { winners: unknown[] }).winners.map(unwrapModel);
    });
  }
  if (!Array.isArray(models)) return [];

  const seen = new Set<string>();
  const channels: DiscoveredChannel[] = [];
  for (const value of models) {
    if (!value || typeof value !== 'object') continue;
    const model = value as Record<string, unknown>;
    const username = cleanUsername(model.username ?? model.login);
    if (!username || seen.has(username.toLowerCase())) continue;
    const isLive = model.isLive === true || model.isOnline === true || stringValue(model.status).toLowerCase() === 'public';
    if (!isLive) continue;
    seen.add(username.toLowerCase());
    const viewers = finiteNumber(model.viewersCount ?? model.viewers ?? model.usersCount) ?? 0;
    channels.push({
      name: stringValue(model.name ?? model.displayName) || username,
      location: `${viewers} viewers · ${stringValue(model.broadcastGender ?? model.gender) || 'live'}`,
      url: new URL(`/${encodeURIComponent(username)}`, sourceUrl.origin).toString(),
      logo: normalizeImage(model.previewUrlThumbBig ?? model.previewUrl ?? model.avatarUrl, sourceUrl),
      ...(normalizeMediaUrl(model.hlsPlaylist ?? (model.stream && typeof model.stream === 'object' ? (model.stream as Record<string, unknown>).url : undefined))
        ? { playbackUrl: normalizeMediaUrl(model.hlsPlaylist ?? (model.stream as Record<string, unknown>)?.url) as string }
        : {}),
      viewers,
    });
  }
  return channels.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
};

export const extractStripchatUsername = (url: URL): string | null => {
  if (!isStripchatUrl(url)) return null;
  const candidate = url.pathname.split('/').filter(Boolean)[0];
  return cleanUsername(candidate);
};

export const buildStripchatRoomUrl = (sourceUrl: URL, username: string): URL =>
  new URL(`/api/front/v2/models/username/${encodeURIComponent(username)}/cam`, sourceUrl.origin);

export const parseStripchatRoomStream = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as { cam?: Record<string, unknown>; user?: { user?: Record<string, unknown> } };
  const cam = root.cam;
  const user = root.user?.user;
  if (!cam || !user) return null;
  const status = stringValue(user.status).toLowerCase();
  if (status && status !== 'public') return null;
  if (user.isLive !== true && user.isOnline !== true) return null;
  if (cam.isCamActive === false) return null;

  const streamName = cleanStreamName(cam.streamName);
  if (!streamName) return null;
  const servers = cam.viewServers;
  if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
    const flashServer = stringValue((servers as Record<string, unknown>)['flashphoner-hls']);
    if (/^[a-z0-9.-]{1,120}$/i.test(flashServer)) {
      return `https://b-${flashServer}.doppiocdn.com/hls/${streamName}/master_${streamName}.m3u8`;
    }
  }
  return `https://edge-hls.doppiocdn.net/hls/${streamName}/master/${streamName}_auto.m3u8?playlistType=lowLatency`;
};

const cleanUsername = (value: unknown): string | null => {
  const text = stringValue(value);
  return /^[a-z0-9_.-]{1,100}$/i.test(text) ? text : null;
};

const unwrapModel = (value: unknown): unknown =>
  value && typeof value === 'object' && 'model' in value ? (value as { model?: unknown }).model : value;

const cleanStreamName = (value: unknown): string | null => {
  const text = stringValue(value);
  return /^[a-z0-9_.-]{1,160}$/i.test(text) ? text : null;
};

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const finiteNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
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

const normalizeMediaUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && /\.m3u8(?:$|[?#])/i.test(url.pathname + url.search) ? url.toString() : null;
  } catch {
    return null;
  }
};
