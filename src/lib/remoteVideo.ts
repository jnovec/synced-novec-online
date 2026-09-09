import { resolveChaturbateStreamUrl } from './chaturbate';
import { isDirectMediaUrl } from './sourceDiscovery';

export const resolveRemoteStreamUrl = async (pageUrl: string, playbackUrl?: string): Promise<string | null> => {
  if (playbackUrl && isDirectMediaUrl(playbackUrl)) return playbackUrl;
  if (isDirectMediaUrl(pageUrl)) return pageUrl;

  const chaturbateUrl = await resolveChaturbateStreamUrl(pageUrl);
  if (chaturbateUrl) return chaturbateUrl;

  try {
    const response = await fetch('/api/video-stream', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: pageUrl }),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { streamUrl?: unknown };
    return typeof data.streamUrl === 'string' && data.streamUrl ? data.streamUrl : null;
  } catch {
    return null;
  }
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

export const normalizeRemoteVideo = (rawUrl: string, suppliedName = '', playbackUrl = '') => {
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
