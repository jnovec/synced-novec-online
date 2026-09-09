import type { DiscoveredChannel } from './sourceDiscovery.ts';

export const isYoutubeUrl = (url: URL): boolean => /(^|\.)youtube\.com$/i.test(url.hostname) || url.hostname.toLowerCase() === 'youtu.be';

export const parseYoutubeVideos = (html: string, sourceUrl: URL): DiscoveredChannel[] => {
  const channels: DiscoveredChannel[] = [];
  const seen = new Set<string>();
  const normalized = html.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
  const add = (id: string, context: string) => {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id) || seen.has(id)) return;
    const title = context.match(/(?:title|aria-label|data-title)\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || `YouTube video ${id}`;
    seen.add(id);
    channels.push({ name: title, location: 'youtube.com', url: `https://www.youtube.com/watch?v=${id}`, logo: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  };

  for (const match of normalized.matchAll(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi)) {
    add(match[1], normalized.slice(Math.max(0, (match.index ?? 0) - 400), (match.index ?? 0) + 900));
  }
  for (const match of normalized.matchAll(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"([\s\S]{0,900})/gi)) add(match[1], match[0]);
  return channels;
};
