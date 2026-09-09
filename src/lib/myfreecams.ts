import type { DiscoveredChannel } from './sourceDiscovery.ts';

export const isMyFreeCamsUrl = (url: URL): boolean => /(^|\.)myfreecams\.com$/i.test(url.hostname);

export const parseMyFreeCamsListing = (html: string, sourceUrl: URL): DiscoveredChannel[] => {
  const channels: DiscoveredChannel[] = [];
  const seen = new Set<string>();
  const normalized = html.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');

  const candidates = [
    ...normalized.matchAll(/(?:data-username|data-room|data-model)\s*=\s*["']([^"']+)["']/gi),
    ...normalized.matchAll(/href\s*=\s*["']\/(?:model|models|room|rooms|cam|cams)?\/?([a-z0-9_.-]{2,80})\/?(?:["'#?])/gi),
  ];

  for (const match of candidates) {
    const username = match[1].trim();
    if (!/^[a-z0-9_.-]{1,80}$/i.test(username) || seen.has(username.toLowerCase())) continue;
    const start = match.index ?? 0;
    const context = normalized.slice(Math.max(0, start - 500), start + 1800);
    const viewers = Number(context.match(/(\d[\d,.]*)\s*(?:viewers?|watching|users?)/i)?.[1]?.replace(/[,.]/g, '') ?? 0);
    const label = context.match(/(?:data-name|aria-label|alt)\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    const imageValue = context.match(/(?:data-thumb-image|data-src|data-original|src)\s*=\s*["']([^"']+)["']/i)?.[1];
    let logo = '';
    if (imageValue && !/^(?:data|blob):/i.test(imageValue)) {
      try { logo = new URL(imageValue.startsWith('//') ? `https:${imageValue}` : imageValue, sourceUrl).toString(); } catch { logo = ''; }
    }
    seen.add(username.toLowerCase());
    channels.push({ name: label || username, location: `${Number.isFinite(viewers) ? viewers : 0} viewers · myfreecams.com`, url: new URL(`/${encodeURIComponent(username)}/`, sourceUrl.origin).toString(), logo, viewers: Number.isFinite(viewers) ? viewers : 0 });
  }

  for (const match of normalized.matchAll(/<div\b([^>]*(?:model_online|modelbox_[^\s>]+)[^>]*)>([\s\S]*?)(?=<div\b[^>]*(?:model_online|modelbox_)|<\/body>|$)/gi)) {
    const body = match[2];
    const title = body.match(/title\s*=\s*["']Enter Chat Room of\s+([^"']+)["']/i)?.[1]?.trim();
    const username = title || body.match(/(?:data-username|data-room|data-model)\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (!username || !/^[a-z0-9_.-]{2,80}$/i.test(username) || seen.has(username.toLowerCase())) continue;
    const viewers = Number(body.match(/(\d[\d,.]*)\s*(?:viewers?|watching|users?)/i)?.[1]?.replace(/[,.]/g, '') ?? 0);
    const imageValue = body.match(/(?:data-src|data-original|data-thumb|src)\s*=\s*["']([^"']+)["']/i)?.[1];
    let logo = '';
    if (imageValue && !/^(?:data|blob):/i.test(imageValue)) {
      try { logo = new URL(imageValue.startsWith('//') ? `https:${imageValue}` : imageValue, sourceUrl).toString(); } catch { logo = ''; }
    }
    seen.add(username.toLowerCase());
    channels.push({ name: username, location: `${Number.isFinite(viewers) ? viewers : 0} viewers · myfreecams.com`, url: `https://mfc.im/${encodeURIComponent(username)}/chat`, logo, viewers: Number.isFinite(viewers) ? viewers : 0 });
  }
  return channels.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
};
