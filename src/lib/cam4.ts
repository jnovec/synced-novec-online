import type { DiscoveredChannel } from './sourceDiscovery.ts';

const RESERVED_CAM4_PATHS = new Set([
  'account',
  'blog',
  'categories',
  'category',
  'couples',
  'faq',
  'females',
  'help',
  'home',
  'login',
  'males',
  'privacy',
  'register',
  'search',
  'signup',
  'tags',
  'terms',
  'trans',
  'videos',
]);

export const isCam4Url = (url: URL): boolean => /(^|\.)cam4\.com$/i.test(url.hostname);

export const isCam4TechnicalChannel = (channel: DiscoveredChannel): boolean => {
  const label = channel.name.trim().toLowerCase();
  return /^(?:index|playlist|master|chunklist|manifest|stream|video)(?:[._-]\d+)?$/.test(label);
};

export const parseCam4Listing = (html: string, sourceUrl: URL): DiscoveredChannel[] => {
  const normalized = normalizeCam4Markup(html);
  const channels = new Map<string, DiscoveredChannel>();

  const addChannel = (rawUsername: string, context: string, playbackUrl?: string) => {
    const username = cleanUsername(rawUsername);
    if (!username) return;

    const key = username.toLowerCase();
    const viewers = extractViewers(context);
    const name = extractDisplayName(context, username);
    const logo = extractImage(context, sourceUrl);
    const normalizedPlaybackUrl = playbackUrl ? resolveMediaUrl(playbackUrl, sourceUrl) : null;
    const existing = channels.get(key);

    if (existing) {
      if (!existing.logo && logo) existing.logo = logo;
      if (!existing.playbackUrl && normalizedPlaybackUrl) existing.playbackUrl = normalizedPlaybackUrl;
      if ((existing.viewers ?? 0) === 0 && viewers > 0) {
        existing.viewers = viewers;
        existing.location = `${viewers} viewers · cam4.com`;
      }
      if (existing.name === username && name !== username) existing.name = name;
      return;
    }

    channels.set(key, {
      name,
      location: `${viewers} viewers · cam4.com`,
      url: new URL(`/${encodeURIComponent(username)}/`, sourceUrl.origin).toString(),
      logo,
      ...(normalizedPlaybackUrl ? { playbackUrl: normalizedPlaybackUrl } : {}),
      viewers,
    });
  };

  // Classic server-rendered CAM4 cards.
  for (const match of normalized.matchAll(/data-username\s*=\s*["']([^"']+)["']/gi)) {
    const start = match.index ?? 0;
    const context = normalized.slice(Math.max(0, start - 900), start + 2600);
    const playbackUrl = findHlsUrl(context, sourceUrl);
    addChannel(match[1], context, playbackUrl ?? undefined);
  }

  // Current CAM4 pages also expose player data in embedded JSON. Associate every
  // HLS URL with the nearest performer identity instead of naming it index/playlist.
  for (const match of normalized.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/gi)) {
    const streamIndex = match.index ?? 0;
    const contextStart = Math.max(0, streamIndex - 3500);
    const contextEnd = Math.min(normalized.length, streamIndex + 3500);
    const context = normalized.slice(contextStart, contextEnd);
    const username = nearestCam4Username(context, streamIndex - contextStart);
    if (username) addChannel(username, context, match[0]);
  }

  return Array.from(channels.values()).sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
};

const nearestCam4Username = (context: string, streamOffset: number): string | null => {
  const candidates: Array<{ username: string; distance: number }> = [];
  const patterns = [
    /data-username\s*=\s*["']([^"']+)["']/gi,
    /["'](?:username|userName|performerName|screenName|nickname)["']\s*:\s*["']([^"']+)["']/gi,
    /(?:https?:)?\/\/(?:www\.)?cam4\.com\/([a-z0-9_.-]{1,80})(?:[/?#"']|$)/gi,
    /href\s*=\s*["']\/([a-z0-9_.-]{1,80})(?:[/?#"']|$)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of context.matchAll(pattern)) {
      const username = cleanUsername(match[1]);
      if (!username) continue;
      const position = match.index ?? 0;
      candidates.push({ username, distance: Math.abs(position - streamOffset) });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.username ?? null;
};

const cleanUsername = (value: string): string | null => {
  const username = value.trim();
  if (!/^[a-z0-9_.-]{1,80}$/i.test(username)) return null;
  if (RESERVED_CAM4_PATHS.has(username.toLowerCase())) return null;
  return username;
};

const extractDisplayName = (context: string, username: string): string => {
  const patterns = [
    /data-display-name\s*=\s*["']([^"']+)["']/i,
    /["'](?:displayName|display_name|performerName)["']\s*:\s*["']([^"']+)["']/i,
    /(?:data-name|aria-label)\s*=\s*["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const value = pattern.exec(context)?.[1]?.trim();
    if (value && !isTechnicalLabel(value)) return value.slice(0, 90);
  }

  return username;
};

const extractViewers = (context: string): number => {
  const raw = context.match(/(?:["'](?:viewerCount|viewers|watching)["']\s*:\s*|)(\d[\d,.]*)\s*(?:viewers?|watching|users?)?/i)?.[1];
  const numeric = Number(raw?.replace(/[,.]/g, '') ?? 0);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
};

const extractImage = (context: string, sourceUrl: URL): string => {
  const patterns = [
    /(?:data-thumb-image|data-src|data-original|src)\s*=\s*["']([^"']+)["']/i,
    /["'](?:thumbnail|thumbUrl|thumbnailUrl|profileImage|imageUrl)["']\s*:\s*["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const raw = pattern.exec(context)?.[1];
    if (!raw || /^(?:data|blob):/i.test(raw)) continue;
    const resolved = resolveMediaUrl(raw, sourceUrl);
    if (resolved && !/\.m3u8(?:$|[?#])/i.test(resolved)) return resolved;
  }

  return '';
};

const findHlsUrl = (context: string, sourceUrl: URL): string | null => {
  const raw = context.match(/(?:https?:)?\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/i)?.[0];
  return raw ? resolveMediaUrl(raw, sourceUrl) : null;
};

const resolveMediaUrl = (rawValue: string, sourceUrl: URL): string | null => {
  try {
    const value = rawValue.replace(/&amp;/gi, '&');
    const url = new URL(value.startsWith('//') ? `https:${value}` : value, sourceUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const isTechnicalLabel = (value: string): boolean =>
  /^(?:index|playlist|master|chunklist|manifest|stream|video)(?:[._-]\d+)?$/i.test(value.trim());

const normalizeCam4Markup = (value: string): string =>
  value
    .replace(/\\u002f/gi, '/')
    .replace(/\\u003a/gi, ':')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');
