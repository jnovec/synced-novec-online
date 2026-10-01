import { normalizeSourceUrl } from './sourceDiscovery.ts';

export const STREAM_RECORDING_DOWNLOAD_DIRECTORY = '~/n8n-stream-downloads';

export const formatStreamRecordingLocationMessage = (jobId: string): string =>
  `Soubory se ukládají do ${STREAM_RECORDING_DOWNLOAD_DIRECTORY}/. Po dokončení ve Finderu vyhledej ID úlohy: ${jobId}.`;

export interface StreamRecordingPayload {
  action: 'start';
  url: string;
}

export const buildStreamRecordingPayload = (rawUrl: unknown): StreamRecordingPayload => {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > 2048) {
    throw new Error('invalid_url');
  }

  const url = normalizeSourceUrl(rawUrl);
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new Error('nonstandard_port_not_allowed');
  }

  return { action: 'start', url: url.toString() };
};

export const isAllowedStreamRecordingOrigin = (origin: string | null): boolean => {
  if (origin === 'https://synced.novec.online') return true;
  if (!origin) return false;

  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      Boolean(parsed.port);
  } catch {
    return false;
  }
};
