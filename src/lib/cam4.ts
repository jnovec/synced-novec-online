import type { DiscoveredChannel } from './sourceDiscovery.ts';

export const isCam4Url = (url: URL): boolean => /(^|\.)cam4\.com$/i.test(url.hostname);

export const parseCam4Listing = (html: string, sourceUrl: URL): DiscoveredChannel[] => {
  const channels: DiscoveredChannel[] = [];
  const seen = new Set<string>();
  const normalized = html.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');

  for (const match of normalized.matchAll(/data-username\s*=\s*["']([^"']+)["']/gi)) {
    const username = match[1].trim();
    if (!/^[a-z0-9_.-]{1,80}$/i.test(username) || seen.has(username.toLowerCase())) continue;
    const start = match.index ?? 0;
    const context = normalized.slice(Math.max(0, start - 500), start + 1800);
    const viewers = Number(context.match(/(\d[\d,.]*)\s*(?:viewers?|watching|users?)/i)?.[1]?.replace(/[,.]/g, '') ?? 0);
    const imageMatch = context.match(/(?:data-thumb-image|data-src|data-original|src)\s*=\s*["']([^"']+)["']/i);
    let logo = '';
    if (imageMatch && !/^(?:data|blob):/i.test(imageMatch[1])) {
      try {
        const image = new URL(imageMatch[1].startsWith('//') ? `https:${imageMatch[1]}` : imageMatch[1], sourceUrl);
        if (['http:', 'https:'].includes(image.protocol)) logo = image.toString();
      } catch {
        logo = '';
      }
    }
    const label = context.match(/(?:data-name|aria-label|alt)\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    seen.add(username.toLowerCase());
    channels.push({
      name: label || username,
      location: `${Number.isFinite(viewers) ? viewers : 0} viewers · cam4.com`,
      url: new URL(`/${encodeURIComponent(username)}/`, sourceUrl.origin).toString(),
      logo,
      viewers: Number.isFinite(viewers) ? viewers : 0,
    });
  }

  return channels.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
};
