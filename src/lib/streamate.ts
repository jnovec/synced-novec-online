import type { DiscoveredChannel } from './sourceDiscovery.ts';

export const isStreamateUrl = (url: URL): boolean =>
  url.hostname.toLowerCase() === 'streamate.com' || url.hostname.toLowerCase().endsWith('.streamate.com');

export const extractStreamateModel = (url: URL): string | null => {
  if (!isStreamateUrl(url)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() !== 'cam' || !parts[1]) return null;
  const model = decodeURIComponent(parts[1]);
  return /^[a-z0-9_.-]{1,100}$/i.test(model) ? model : null;
};

export const buildStreamateManifestUrl = (model: string): URL =>
  new URL(`/live/s:${encodeURIComponent(model)}.json`, 'https://manifest-server.naiadsystems.com');

export const parseStreamateManifest = (payload: unknown, pageUrl: URL): DiscoveredChannel | null => {
  if (!payload || typeof payload !== 'object') return null;
  const formats = (payload as { formats?: Record<string, unknown> }).formats;
  const manifest = formats?.['mp4-hls'];
  if (typeof manifest !== 'string') return null;
  try {
    const playbackUrl = new URL(manifest);
    if (playbackUrl.protocol !== 'https:' || !/\.m3u8(?:$|[?#])/i.test(playbackUrl.pathname + playbackUrl.search)) return null;
    const model = extractStreamateModel(pageUrl);
    if (!model) return null;
    return {
      name: model,
      location: 'streamate.com',
      url: pageUrl.toString(),
      logo: '',
      playbackUrl: playbackUrl.toString(),
    };
  } catch {
    return null;
  }
};
