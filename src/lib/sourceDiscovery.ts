export interface DiscoveredChannel {
  name: string;
  location: string;
  url: string;
  logo: string;
  playbackUrl?: string;
  viewers?: number;
}

const MEDIA_EXTENSION = /\.(?:m3u8|mp4|webm|mpd|m4v|mov)(?:$|[?#])/i;
const VIDEO_PAGE_PATH = /\/(?:profile|profiles|room|rooms|model|models|performer|performers|cam|cams|live|watch|video|videos|stream|streams)(?:\/|$)/i;
const SKIPPED_PAGE_PATH = /\/(?:login|logout|sign-?up|register|support|help|privacy|terms|blog|news|contact|category|categories|tag|tags)(?:\/|$)/i;
const GENERIC_TITLES = new Set(['watch', 'video', 'live', 'stream', 'profile', 'open', 'view', 'play']);

export const normalizeSourceUrl = (rawUrl: string): URL => {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error('missing_url');

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only_http_urls');
  if (url.username || url.password) throw new Error('url_credentials_not_allowed');

  url.hash = '';
  return url;
};

export const sourceCategoryName = (url: URL): string =>
  url.hostname.toLowerCase().replace(/^www\./, '') || 'nový zdroj';

export const isDirectMediaUrl = (rawUrl: string): boolean => {
  try {
    return MEDIA_EXTENSION.test(new URL(rawUrl).href);
  } catch {
    return false;
  }
};

export const extractEmbeddedMediaUrls = (html: string, baseUrl: URL): string[] => {
  const normalizedHtml = normalizeEscapedMarkup(html);
  const candidates: string[] = [];

  for (const match of normalizedHtml.matchAll(/<(?:video|source)\b[^>]*>/gi)) {
    const tag = match[0];
    for (const attribute of ['src', 'data-src', 'data-video', 'data-hls', 'data-stream']) {
      const value = readAttribute(tag, attribute);
      if (value) candidates.push(value);
    }
  }

  for (const match of normalizedHtml.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]+/gi)) {
    candidates.push(match[0]);
  }

  return uniqueHttpUrls(candidates, baseUrl).filter(isDirectMediaUrl);
};

export const extractVideoChannels = (html: string, baseUrl: URL, limit = 200): DiscoveredChannel[] => {
  const normalizedHtml = normalizeEscapedMarkup(html);
  const channels: DiscoveredChannel[] = [];
  const usedUrls = new Set<string>();

  for (const match of normalizedHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (channels.length >= limit) break;

    const openingAttributes = match[1];
    const body = match[2];
    const href = readAttribute(openingAttributes, 'href');
    const pageUrl = href ? resolveHttpUrl(href, baseUrl) : null;
    if (!pageUrl || usedUrls.has(pageUrl)) continue;

    const parsedPageUrl = new URL(pageUrl);
    const playbackUrl = firstEmbeddedMediaUrl(`${openingAttributes}>${body}`, baseUrl);
    const image = firstImage(body, baseUrl);
    const classNames = `${readAttribute(openingAttributes, 'class') ?? ''} ${readAttribute(openingAttributes, 'data-testid') ?? ''}`;
    const hasVideoHint = /\b(?:model|performer|room|cam|video|live|stream|player|thumbnail|preview)\b/i.test(classNames);
    const hasDataHint = /\bdata-(?:model|room|video|stream|performer)(?:-|\s*=)/i.test(openingAttributes);
    const isLikelyVideoPage = VIDEO_PAGE_PATH.test(parsedPageUrl.pathname) && !SKIPPED_PAGE_PATH.test(parsedPageUrl.pathname);

    if (!playbackUrl && !isLikelyVideoPage && !(image && (hasVideoHint || hasDataHint))) continue;

    const name = getChannelName(openingAttributes, body, parsedPageUrl);
    if (!name) continue;

    usedUrls.add(pageUrl);
    channels.push({
      name,
      location: getLocation(body, parsedPageUrl.hostname),
      url: pageUrl,
      logo: image ?? '',
      ...(playbackUrl ? { playbackUrl } : {}),
    });
  }

  for (const mediaUrl of extractEmbeddedMediaUrls(normalizedHtml, baseUrl)) {
    if (channels.length >= limit || usedUrls.has(mediaUrl)) continue;
    usedUrls.add(mediaUrl);
    const media = new URL(mediaUrl);
    channels.push({
      name: filenameLabel(media),
      location: media.hostname,
      url: mediaUrl,
      logo: '',
      playbackUrl: mediaUrl,
    });
  }

  return channels;
};

const firstEmbeddedMediaUrl = (markup: string, baseUrl: URL): string | null => {
  const urls = extractEmbeddedMediaUrls(markup, baseUrl);
  return urls.find((url) => /\.m3u8(?:$|[?#])/i.test(url)) ?? urls[0] ?? null;
};

const firstImage = (markup: string, baseUrl: URL): string | null => {
  const imageTag = markup.match(/<img\b[^>]*>/i)?.[0];
  if (!imageTag) return null;

  for (const attribute of ['data-src', 'data-original', 'data-lazy-src', 'src']) {
    const value = readAttribute(imageTag, attribute);
    const resolved = value ? resolveHttpUrl(value, baseUrl) : null;
    if (resolved) return resolved;
  }

  const srcset = readAttribute(imageTag, 'srcset') ?? readAttribute(imageTag, 'data-srcset');
  const firstSrcsetItem = srcset?.split(',')[0]?.trim().split(/\s+/)[0];
  return firstSrcsetItem ? resolveHttpUrl(firstSrcsetItem, baseUrl) : null;
};

const getChannelName = (openingAttributes: string, body: string, pageUrl: URL): string => {
  const imageTag = body.match(/<img\b[^>]*>/i)?.[0] ?? '';
  const candidates = [
    readAttribute(openingAttributes, 'aria-label'),
    readAttribute(openingAttributes, 'title'),
    readAttribute(openingAttributes, 'data-name'),
    readAttribute(openingAttributes, 'data-model-name'),
    readAttribute(imageTag, 'alt'),
    readAttribute(imageTag, 'title'),
    stripMarkup(body),
  ];

  for (const candidate of candidates) {
    const cleaned = cleanLabel(candidate ?? '');
    if (cleaned && !GENERIC_TITLES.has(cleaned.toLowerCase())) return cleaned;
  }

  const pathParts = pageUrl.pathname.split('/').filter(Boolean);
  return cleanLabel(decodeURIComponent(pathParts.at(-1) ?? pageUrl.hostname));
};

const getLocation = (markup: string, hostname: string): string => {
  const text = stripMarkup(markup);
  const viewers = text.match(/(?:^|\s)(\d[\d\s,.]{0,8})\s*(?:viewers?|watching|online|divák(?:ů|i)?)/i)?.[1];
  return viewers ? `${viewers.trim()} viewers · ${hostname}` : hostname;
};

const filenameLabel = (url: URL): string => {
  const filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? 'video');
  const withoutExtension = filename.replace(/\.(?:m3u8|mp4|webm|mpd|m4v|mov)$/i, '');
  return cleanLabel(withoutExtension.replace(/[-_]+/g, ' ')) || 'video';
};

const uniqueHttpUrls = (values: string[], baseUrl: URL): string[] => {
  const urls = new Set<string>();
  for (const value of values) {
    const resolved = resolveHttpUrl(value, baseUrl);
    if (resolved) urls.add(resolved);
  }
  return Array.from(urls);
};

const resolveHttpUrl = (rawValue: string, baseUrl: URL): string | null => {
  const value = decodeHtmlEntities(normalizeEscapedMarkup(rawValue)).trim();
  if (!value || value.startsWith('#') || /^(?:data|blob|javascript|mailto|tel):/i.test(value)) return null;

  try {
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (isObviouslyLocalHostname(url.hostname)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const readAttribute = (markup: string, name: string): string | null => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\u0060]+))`, 'i');
  const match = markup.match(expression);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
};

const stripMarkup = (markup: string): string =>
  decodeHtmlEntities(
    markup
      .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );

const cleanLabel = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 90);

const normalizeEscapedMarkup = (value: string): string =>
  value
    .replace(/\\u002f/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003a/gi, ':')
    .replace(/\\\//g, '/');

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));

const isObviouslyLocalHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized === '0.0.0.0' ||
    normalized === '127.0.0.1' ||
    normalized === '::' ||
    normalized === '::1'
  );
};
