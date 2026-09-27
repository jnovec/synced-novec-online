import { PornHub } from 'pornhub.js';
import xvideos from '@rodrigogs/xvideos';
import type { DiscoveredChannel } from '@/lib/sourceDiscovery';

const pornhub = new PornHub();

export const isPornhubUrl = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '') === 'pornhub.com';
export const isXvideosUrl = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '') === 'xvideos.com';

export const discoverPornhub = async (sourceUrl: URL, page = 1): Promise<DiscoveredChannel[]> => {
  const viewKey = sourceUrl.searchParams.get('viewkey');
  if (viewKey) return [channelFromPornhubVideo(await pornhub.video(sourceUrl.toString()), sourceUrl)];

  const query = sourceUrl.searchParams.get('search') ?? '';
  if (!query) return [];
  const result = await pornhub.searchVideo(query, { page });
  const entries = Array.isArray(result?.data) ? result.data.slice(0, 12) : [];
  return (await Promise.all(entries.map(async (entry: any) => {
    try {
      return channelFromPornhubVideo(await pornhub.video(entry.url), sourceUrl);
    } catch {
      return {
        name: String(entry.title ?? 'Pornhub video'),
        location: 'pornhub.com',
        url: String(entry.url),
        logo: String(entry.preview ?? ''),
      } satisfies DiscoveredChannel;
    }
  }))).filter(Boolean);
};

export const discoverXvideos = async (sourceUrl: URL, page = 1): Promise<DiscoveredChannel[]> => {
  const query = sourceUrl.searchParams.get('k') ?? '';
  if (!query) return [];
  const result = await xvideos.videos.search({ k: query, page });
  const entries = result.videos.slice(0, 12);
  return (await Promise.all(entries.map(async (entry) => {
    try {
      const details = await xvideos.videos.details({ url: entry.url });
      const playbackUrl = details.files.HLS || details.files.high || details.files.low;
      return {
        name: details.title || entry.title,
        location: `${details.duration} · xvideos.com`,
        url: entry.url,
        logo: details.files.thumb || entry.thumbnailUrl,
        ...(playbackUrl ? { playbackUrl } : {}),
      } satisfies DiscoveredChannel;
    } catch {
      return {
        name: entry.title,
        location: `${entry.duration} · xvideos.com`,
        url: entry.url,
        logo: entry.thumbnailUrl,
      } satisfies DiscoveredChannel;
    }
  }))).filter(Boolean);
};

const channelFromPornhubVideo = (video: any, sourceUrl: URL): DiscoveredChannel => {
  const playbackUrl = Array.isArray(video.mediaDefinitions)
    ? video.mediaDefinitions.find((definition: any) => definition.defaultQuality)?.videoUrl
      ?? video.mediaDefinitions.find((definition: any) => typeof definition.videoUrl === 'string')?.videoUrl
    : undefined;
  return {
    name: String(video.title ?? 'Pornhub video'),
    location: `${video.durationFormatted ?? video.duration ?? ''} · pornhub.com`.trim(),
    url: String(video.url ?? sourceUrl.toString()),
    logo: typeof video.thumb === 'string' && !video.thumb.startsWith('data:') ? video.thumb : '',
    ...(playbackUrl ? { playbackUrl: String(playbackUrl) } : {}),
  };
};
