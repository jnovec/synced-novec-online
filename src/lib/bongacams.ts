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

export const buildBongaListingUrl = (sourceUrl: URL, liveTab?: string): URL => {
  const listingUrl = new URL('/tools/listing_v3.php', sourceUrl.origin);
  listingUrl.searchParams.set('livetab', liveTab || bongaLiveTab(sourceUrl));
  listingUrl.searchParams.set('online_only', 'true');
  listingUrl.searchParams.set('offset', '0');
  listingUrl.searchParams.set('can_pin_models', 'false');
  listingUrl.searchParams.set('limit', '200');
  return listingUrl;
};

export const parseBongaHomepage = (html: string, sourceUrl: URL): DiscoveredChannel[] => {
  const normalized = html
    .replace(/\\u002f/gi, '/')
    .replace(/\\u003a/gi, ':')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');
  const channels: DiscoveredChannel[] = [];
  const seen = new Set<string>();

  for (const match of normalized.matchAll(/<a\b([^>]*)href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1] ?? '';
    const href = (match[2] ?? match[3] ?? '').trim();
    const body = match[4] ?? '';
    const profileMatch = href.match(/^\/?profile\/([a-z0-9_.-]{1,80})(?:[/?#]|$)/i);
    if (!profileMatch) continue;

    const username = cleanUsername(profileMatch[1]);
    if (!username || seen.has(username.toLowerCase())) continue;

    const imageTag = body.match(/<img\b[^>]*>/i)?.[0] ?? '';
    const name = firstUsefulLabel([
      readAttribute(attributes, 'aria-label'),
      readAttribute(attributes, 'title'),
      readAttribute(attributes, 'data-name'),
      readAttribute(attributes, 'data-model-name'),
      readAttribute(imageTag, 'alt'),
      readAttribute(imageTag, 'title'),
      stripMarkup(body),
      username,
    ]) || username;
    const viewers = extractViewerCount(body);
    const logo = firstImageUrl(imageTag, sourceUrl);

    seen.add(username.toLowerCase());
    channels.push({
      name,
      location: `${viewers} viewers · bongacams.com`,
      url: new URL(`/profile/${encodeURIComponent(username)}`, sourceUrl.origin).toString(),
      logo,
      viewers,
    });
  }

  return channels;
};

export const parseBongaListing = (payload: unknown, sourceUrl: URL): DiscoveredChannel[] => {
  if (!payload || typeof payload !== 'object') return [];
  const models = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as BongaListing).models)
      ? (payload as BongaListing).models
      : (payload as { data?: BongaListing }).data?.models;
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

const firstImageUrl = (imageTag: string, sourceUrl: URL): string => {
  for (const attribute of ['data-src', 'data-original', 'data-lazy-src', 'src']) {
    const raw = readAttribute(imageTag, attribute);
    if (!raw || /^(?:data|blob):/i.test(raw)) continue;
    try {
      const image = new URL(raw.startsWith('//') ? `https:${raw}` : decodeHtml(raw), sourceUrl);
      if (['http:', 'https:'].includes(image.protocol)) return image.toString();
    } catch {
      // Try the next image attribute.
    }
  }
  return '';
};

const extractViewerCount = (markup: string): number => {
  const text = stripMarkup(markup);
  const raw = text.match(/(\d[\d\s,.]{0,8})\s*(?:viewers?|watching|online|users?)/i)?.[1];
  const numeric = Number((raw ?? '0').replace(/[\s,.]/g, ''));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
};

const firstUsefulLabel = (values: Array<string | null>): string => {
  const generic = new Set(['watch', 'live', 'profile', 'open', 'view']);
  for (const value of values) {
    const cleaned = decodeHtml(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (cleaned && !generic.has(cleaned.toLowerCase())) return cleaned;
  }
  return '';
};

const readAttribute = (markup: string, name: string): string | null => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markup.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
};

const stripMarkup = (markup: string): string =>
  decodeHtml(markup.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

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
