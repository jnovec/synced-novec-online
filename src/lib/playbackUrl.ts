export const isHlsPlaybackUrl = (url: string): boolean => /\.m3u8(?:$|[?#])/i.test(url);
