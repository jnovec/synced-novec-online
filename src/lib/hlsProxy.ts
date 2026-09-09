
export const isAllowedHlsUpstream = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.live.mmcdn.com') &&
      url.pathname.startsWith('/v1/edge/streams/')
    );
  } catch {
    return false;
  }
};

export const rewriteHlsPlaylist = (playlist: string, upstreamUrl: string, proxyPath: string): string => {
  const proxy = (value: string) => {
    const absolute = new URL(value, upstreamUrl).toString();
    return `${proxyPath}?url=${encodeURIComponent(absolute)}`;
  };

  return playlist
    .split('\n')
    .map((line) => {
      const withUris = line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${proxy(uri)}"`);
      if (!withUris || withUris.startsWith('#')) return withUris;
      return proxy(withUris.trim());
    })
    .join('\n');
};


