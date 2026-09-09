import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeSourceUrl } from './sourceDiscovery.ts';

const DEFAULT_MAX_BYTES = 3_000_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface SafeTextResponse {
  text: string;
  finalUrl: URL;
  contentType: string;
  setCookies: string[];
}

export const fetchPublicText = async (rawUrl: string | URL, options: SafeFetchOptions = {}): Promise<SafeTextResponse> => {
  let currentUrl = rawUrl instanceof URL ? new URL(rawUrl) : normalizeSourceUrl(rawUrl);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicRemoteUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'text/html, application/xhtml+xml, application/json;q=0.8, text/plain;q=0.7, */*;q=0.5',
          'accept-language': 'en-US,en;q=0.8',
          'user-agent': 'Mozilla/5.0 (compatible; MultiScreen/1.0; +https://synced.novec.online)',
          ...options.headers,
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`source_http_${response.status}`);
      if (redirects === MAX_REDIRECTS) throw new Error('too_many_redirects');
      currentUrl = normalizeSourceUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) throw new Error(`source_http_${response.status}`);

    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > maxBytes) throw new Error('source_too_large');

    return {
      text: await readLimitedText(response, maxBytes),
      finalUrl: currentUrl,
      contentType: response.headers.get('content-type') ?? '',
      setCookies: readSetCookies(response.headers),
    };
  }

  throw new Error('too_many_redirects');
};

const readSetCookies = (headers: Headers): string[] => {
  const compatibleHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const cookies = compatibleHeaders.getSetCookie?.();
  if (cookies?.length) return cookies;
  const cookie = headers.get('set-cookie');
  return cookie ? [cookie] : [];
};

export const assertPublicRemoteUrl = async (url: URL): Promise<void> => {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only_http_urls');
  if (url.username || url.password) throw new Error('url_credentials_not_allowed');
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('nonstandard_port_not_allowed');

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('private_address_not_allowed');
  }

  const literalVersion = isIP(hostname);
  if (literalVersion && !isPublicIpAddress(hostname)) throw new Error('private_address_not_allowed');

  if (!literalVersion) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
      throw new Error('private_address_not_allowed');
    }
  }
};

export const isPublicIpAddress = (address: string): boolean => {
  const normalized = address.toLowerCase().split('%')[0];
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);

  const version = isIP(normalized);
  if (version === 4) return isPublicIpv4(normalized);
  if (version !== 6) return false;

  const groups = expandIpv6(normalized);
  if (!groups) return false;
  const [first, second] = groups;
  const isUnspecified = groups.every((group) => group === 0);
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;

  return !(
    isUnspecified ||
    isLoopback ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8)
  );
};

const isPublicIpv4 = (address: string): boolean => {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;

  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const expandIpv6 = (address: string): number[] | null => {
  const [leftRaw, rightRaw] = address.split('::');
  if (address.split('::').length > 2) return null;
  const left = leftRaw ? leftRaw.split(':').filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if ((!address.includes('::') && missing !== 0) || missing < 0) return null;

  const values = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((group) => Number.parseInt(group, 16));
  return values.length === 8 && values.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? values
    : null;
};

const readLimitedText = async (response: Response, maxBytes: number): Promise<string> => {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('source_too_large');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
};
