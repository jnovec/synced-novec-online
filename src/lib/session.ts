import { DEFAULT_AUDIO_SETTINGS, normalizeAudioSettings } from './audioControls.ts';
import type { AudioSettings } from './audioControls.ts';
import { isDisplaySlot } from './displayMedia.ts';
import type { VideoSlot } from './displayMedia.ts';

export const SESSION_VERSION = 1;
export const SESSION_SLOT_COUNT = 9;
export const DEFAULT_SESSION_SHARE_ORIGIN = 'https://synced.novec.online';

export interface AppSession {
  version: typeof SESSION_VERSION;
  name: string;
  createdAt: string;
  gridSize: number;
  slots: (VideoSlot | null)[];
  audioSettings: AudioSettings[];
  selectedVideo: VideoSlot | null;
}

const normalizeSlot = (value: unknown): VideoSlot | null => {
  if (!value || typeof value !== 'object') return null;
  const slot = value as Partial<VideoSlot>;
  if (typeof slot.name !== 'string') return null;

  if (slot.sourceType === 'display') {
    return { name: slot.name || 'App/Window Share', url: '', sourceType: 'display' };
  }
  if (typeof slot.url !== 'string' || !/^https?:\/\//i.test(slot.url)) return null;
  return {
    name: slot.name,
    url: slot.url,
    sourceType: 'remote',
    ...(typeof slot.playbackUrl === 'string' && /^https?:\/\//i.test(slot.playbackUrl)
      ? { playbackUrl: slot.playbackUrl }
      : {}),
  };
};

export const createAppSession = (input: {
  name: string;
  gridSize: number;
  slots: (VideoSlot | null)[];
  audioSettings: AudioSettings[];
  selectedVideo: VideoSlot | null;
}): AppSession => ({
  version: SESSION_VERSION,
  name: input.name.trim() || `Session ${new Date().toLocaleString()}`,
  createdAt: new Date().toISOString(),
  gridSize: input.gridSize,
  slots: Array.from({ length: SESSION_SLOT_COUNT }, (_, index) => {
    const slot = input.slots[index];
    if (!slot) return null;
    return isDisplaySlot(slot)
      ? { name: slot.name, url: '', sourceType: 'display' as const }
      : {
          name: slot.name,
          url: slot.url,
          sourceType: 'remote' as const,
          ...(slot.playbackUrl ? { playbackUrl: slot.playbackUrl } : {}),
        };
  }),
  audioSettings: Array.from(
    { length: SESSION_SLOT_COUNT },
    (_, index) => normalizeAudioSettings(input.audioSettings[index] ?? DEFAULT_AUDIO_SETTINGS)
  ),
  selectedVideo: isDisplaySlot(input.selectedVideo) ? null : normalizeSlot(input.selectedVideo),
});

export const normalizeAppSession = (value: unknown): AppSession => {
  if (!value || typeof value !== 'object') throw new Error('Session nemá platný JSON formát.');
  const session = value as Partial<AppSession>;
  if (session.version !== SESSION_VERSION) throw new Error('Tato verze session není podporována.');
  if (!Array.isArray(session.slots)) throw new Error('Session neobsahuje seznam oken.');

  return {
    version: SESSION_VERSION,
    name: typeof session.name === 'string' && session.name.trim() ? session.name.trim() : 'Importovaná session',
    createdAt: typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
    gridSize: typeof session.gridSize === 'number' && [1, 2, 3, 4, 5, 6, 7, 9].includes(session.gridSize)
      ? session.gridSize
      : 9,
    slots: Array.from({ length: SESSION_SLOT_COUNT }, (_, index) => normalizeSlot(session.slots?.[index])),
    audioSettings: Array.from(
      { length: SESSION_SLOT_COUNT },
      (_, index) => normalizeAudioSettings(session.audioSettings?.[index] ?? DEFAULT_AUDIO_SETTINGS)
    ),
    selectedVideo: normalizeSlot(session.selectedVideo),
  };
};

const normalizePastesId = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(trimmed) ? trimmed : null;
};

const parsePastesIdInternal = (value: string, depth: number): string | null => {
  const trimmed = value.trim();
  const direct = normalizePastesId(trimmed);
  if (direct) return direct;
  if (depth > 2) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    for (const key of ['session', 'paste']) {
      const queryValue = url.searchParams.get(key);
      if (queryValue) {
        const parsed = parsePastesIdInternal(queryValue, depth + 1);
        if (parsed) return parsed;
      }
    }

    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 's' || pathParts[0] === 'session') {
      return normalizePastesId(decodeURIComponent(pathParts[1] ?? ''));
    }

    if (url.hostname === 'pastes.io' || url.hostname === 'www.pastes.io') {
      const idPart = pathParts[0] === 'raw' ? pathParts[1] : pathParts[0];
      return normalizePastesId(idPart ? decodeURIComponent(idPart) : '');
    }
  } catch {
    return null;
  }

  return null;
};

export const parsePastesId = (value: string): string | null => parsePastesIdInternal(value, 0);

export const getPastesIdFromLocation = (location: Pick<Location, 'pathname' | 'search'>): string | null => {
  const params = new URLSearchParams(location.search);
  for (const key of ['session', 'paste']) {
    const value = params.get(key);
    if (value) {
      const parsed = parsePastesId(value);
      if (parsed) return parsed;
    }
  }

  const pathMatch = location.pathname.match(/^\/(?:s|session)\/([^/]+)\/?$/i);
  return pathMatch ? normalizePastesId(pathMatch[1]) : null;
};

export const buildSessionShareUrl = (
  paste: string,
  origin = process.env.NEXT_PUBLIC_SESSION_SHARE_ORIGIN?.trim() || DEFAULT_SESSION_SHARE_ORIGIN
): string => {
  const id = parsePastesId(paste);
  if (!id) throw new Error('Nelze vytvořit odkaz z neplatného Pastes.io ID.');

  const url = new URL(origin);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Adresa aplikace musí používat HTTP nebo HTTPS.');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set('session', id);
  return url.toString();
};
