import { resolveChaturbateStreamUrl } from './chaturbate';
import { isDirectMediaUrl } from './sourceDiscovery';

// Limit discovery requests only; active video playback remains concurrent.
const MAX_CONCURRENT_RESOLUTIONS = 3;
const RESOLVED_URL_CACHE_MS = 8_000;
const FAILED_RESOLUTION_COOLDOWN_MS = 5_000;
let activeResolutions = 0;
const resolutionQueue: Array<{
  task: () => Promise<string | null>;
  resolve: (value: string | null) => void;
}> = [];
const pendingResolutions = new Map<string, Promise<string | null>>();
const resolvedUrlCache = new Map<string, { url: string; until: number }>();
const failedResolutionCooldowns = new Map<string, number>();
const HLS_PROXY_PATH = '/api/chaturbate-hls.m3u8';

const isChaturbatePage = (rawUrl: string): boolean => {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === 'chaturbate.com' || hostname.endsWith('.chaturbate.com');
  } catch {
    return false;
  }
};

const proxyPornhubHls = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.endsWith('.phncdn.com') || !/\.m3u8(?:$|[?#])/i.test(url.href)) return null;
    return `${HLS_PROXY_PATH}?url=${encodeURIComponent(url.toString())}`;
  } catch {
    return null;
  }
};

const runNextResolution = () => {
  while (activeResolutions < MAX_CONCURRENT_RESOLUTIONS && resolutionQueue.length) {
    const next = resolutionQueue.shift();
    if (!next) return;
    activeResolutions += 1;
    void next.task()
      .then(next.resolve, () => next.resolve(null))
      .finally(() => {
        activeResolutions -= 1;
        runNextResolution();
      });
  }
};

const resolveRemoteStreamUrlInternal = async (pageUrl: string, playbackUrl?: string): Promise<string | null> => {
  if (playbackUrl && isDirectMediaUrl(playbackUrl)) return proxyPornhubHls(playbackUrl) ?? playbackUrl;
  if (isDirectMediaUrl(pageUrl)) return pageUrl;

  if (isChaturbatePage(pageUrl)) return resolveChaturbateStreamUrl(pageUrl);

  try {
    const response = await fetch('/api/video-stream', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: pageUrl }),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return null;
    const data = (await response.json()) as { streamUrl?: unknown };
    return typeof data.streamUrl === 'string' && data.streamUrl ? data.streamUrl : null;
  } catch {
    return null;
  }
};

export const resolveRemoteStreamUrl = (pageUrl: string, playbackUrl?: string): Promise<string | null> => {
  const key = `${pageUrl}\n${playbackUrl ?? ''}`;
  const now = Date.now();
  for (const [cacheKey, value] of resolvedUrlCache) if (value.until <= now) resolvedUrlCache.delete(cacheKey);
  for (const [cooldownKey, until] of failedResolutionCooldowns) if (until <= now) failedResolutionCooldowns.delete(cooldownKey);
  const cached = resolvedUrlCache.get(key);
  if (cached) {
    if (cached.until > now) return Promise.resolve(cached.url);
    resolvedUrlCache.delete(key);
  }

  const failedUntil = failedResolutionCooldowns.get(key);
  if (failedUntil) {
    return Promise.resolve(null);
  }

  const pending = pendingResolutions.get(key);
  if (pending) return pending;

  const promise = new Promise<string | null>((resolve) => {
    resolutionQueue.push({
      task: () => resolveRemoteStreamUrlInternal(pageUrl, playbackUrl),
      resolve,
    });
    runNextResolution();
  })
    .then((resolvedUrl) => {
      if (resolvedUrl) {
        resolvedUrlCache.set(key, { url: resolvedUrl, until: Date.now() + RESOLVED_URL_CACHE_MS });
        failedResolutionCooldowns.delete(key);
      } else {
        failedResolutionCooldowns.set(key, Date.now() + FAILED_RESOLUTION_COOLDOWN_MS);
      }
      return resolvedUrl;
    })
    .finally(() => {
      pendingResolutions.delete(key);
    });

  pendingResolutions.set(key, promise);
  return promise;
};

export const shouldEmbedRemotePage = (rawUrl: string): boolean => {
  if (isDirectMediaUrl(rawUrl)) return false;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return !(host === 'chaturbate.com' || host.endsWith('.chaturbate.com'));
  } catch {
    return false;
  }
};

export const normalizeRemoteVideo = (rawUrl: string, suppliedName = '', playbackUrl = '', thumbnailUrl = '') => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const fallbackName = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname);
    const normalizedPlaybackUrl = normalizeOptionalHttpUrl(playbackUrl);

    return {
      url: url.toString(),
      name: suppliedName.trim() || fallbackName,
      sourceType: 'remote' as const,
      ...(normalizedPlaybackUrl ? { playbackUrl: normalizedPlaybackUrl } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    };
  } catch {
    return null;
  }
};

const normalizeOptionalHttpUrl = (rawUrl: string): string | null => {
  if (!rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
};
