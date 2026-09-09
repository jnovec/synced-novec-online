import type { DiscoveredChannel } from './sourceDiscovery.ts';

export const isCamSodaUrl = (url: URL): boolean => /(^|\.)camsoda\.com$/i.test(url.hostname);

export const parseCamSodaListing = (html: string, sourceUrl: URL): DiscoveredChannel[] => {
  const channels: DiscoveredChannel[] = [];
  const seen = new Set<string>();
  const normalized = html.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');

  for (const match of normalized.matchAll(/data-username\s*=\s*["']([^"']+)["']/gi)) {
    const username = cleanUsername(match[1]);
    if (!username || seen.has(username.toLowerCase())) continue;
    const context = normalized.slice(Math.max(0, (match.index ?? 0) - 500), (match.index ?? 0) + 1800);
    const viewers = Number(context.match(/(\d[\d,.]*)\s*(?:viewers?|watching|users?)/i)?.[1]?.replace(/[,.]/g, '') ?? 0);
    const image = findImage(context, sourceUrl);
    const label = context.match(/(?:data-name|aria-label|alt)\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    seen.add(username.toLowerCase());
    channels.push({
      name: label || username,
      location: `${Number.isFinite(viewers) ? viewers : 0} viewers · camsoda.com`,
      url: new URL(`/${encodeURIComponent(username)}/`, sourceUrl.origin).toString(),
      logo: image,
      viewers: Number.isFinite(viewers) ? viewers : 0,
    });
  }

  return channels.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
};

const cleanUsername = (value: string): string | null => {
  const username = value.trim();
  return /^[a-z0-9_.-]{1,80}$/i.test(username) ? username : null;
};

const findImage = (context: string, sourceUrl: URL): string => {
  const match = context.match(/(?:data-thumb-image|data-src|data-original|src)\s*=\s*["']([^"']+)["']/i);
  if (!match || /^(?:data|blob):/i.test(match[1])) return '';
  try {
    const image = new URL(match[1].startsWith('//') ? `https:${match[1]}` : match[1], sourceUrl);
    return ['http:', 'https:'].includes(image.protocol) ? image.toString() : '';
  } catch {
    return '';
  }
};
