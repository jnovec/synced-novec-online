import type { DiscoveredChannel } from './sourceDiscovery.ts';
import { buildStreamateManifestUrl, extractStreamateModel, parseStreamateManifest } from './streamate.ts';
import { assertPublicRemoteUrl, fetchPublicText } from './safeRemoteFetch.ts';

/**
 * Site-specific listing and room extraction hooks used by /api/video-source.
 * An adapter returns normalized list entries; the generic HTML discoverer is
 * retained as the fallback for sites without a dedicated implementation.
 */
export interface StreamSourceAdapter {
  id: string;
  matches(url: URL): boolean;
  discoverListing?(url: URL): Promise<DiscoveredChannel[]>;
  discoverRoom?(url: URL): Promise<DiscoveredChannel[]>;
}

const HOSTS: Record<string, readonly string[]> = {
  'cams.com': ['cams.com', 'streamray.com'],
  'streamate.com': ['streamate.com'],
  'flirt4free.com': ['flirt4free.com'],
  'xlovecam.com': ['xlovecam.com'],
  'dreamcam.com': ['dreamcam.com'],
  'eplay.com': ['eplay.com'],
  'sinparty.com': ['sinparty.com'],
};

const hostnameMatches = (url: URL, hosts: readonly string[]): boolean =>
  hosts.some((host) => url.hostname.toLowerCase() === host || url.hostname.toLowerCase().endsWith(`.${host}`));

/** The new adapters are prioritized over generic HTML extraction. */
export const streamSourceAdapters: readonly StreamSourceAdapter[] = Object.entries(HOSTS).map(([id, hosts]) => ({
  id,
  matches: (url) => hostnameMatches(url, hosts),
  ...(id === 'streamate.com' ? {
    discoverRoom: async (url: URL) => {
      const model = extractStreamateModel(url);
      if (!model) return [];
      const endpoint = buildStreamateManifestUrl(model);
      await assertPublicRemoteUrl(endpoint);
      const response = await fetchPublicText(endpoint, { maxBytes: 1_000_000, timeoutMs: 15_000 });
      let payload: unknown;
      try { payload = JSON.parse(response.text); } catch { return []; }
      const channel = parseStreamateManifest(payload, url);
      return channel ? [channel] : [];
    },
  } : {}),
}));

export const findStreamSourceAdapter = (url: URL): StreamSourceAdapter | undefined =>
  streamSourceAdapters.find((adapter) => adapter.matches(url));
