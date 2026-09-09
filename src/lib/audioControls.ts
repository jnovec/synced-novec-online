export interface AudioSettings {
  muted: boolean;
  volume: number;
}

interface ControllableMedia {
  muted: boolean;
  volume: number;
  play: () => Promise<unknown>;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  muted: true,
  volume: 0.5,
};

const clampVolume = (volume: number) => Math.min(1, Math.max(0, volume));

export const setAudioMuted = (settings: AudioSettings, muted: boolean): AudioSettings => ({
  ...settings,
  muted,
});

export const setAudioVolume = (settings: AudioSettings, volume: number): AudioSettings => ({
  ...settings,
  volume: clampVolume(volume),
});

export const applyMediaAudio = async (media: ControllableMedia, settings: AudioSettings) => {
  media.muted = settings.muted;
  media.volume = clampVolume(settings.volume);
  if (!settings.muted) await media.play();
};

export const normalizeAudioSettings = (value: unknown): AudioSettings => {
  if (!value || typeof value !== 'object') return DEFAULT_AUDIO_SETTINGS;

  const maybe = value as Partial<AudioSettings>;
  if (typeof maybe.muted !== 'boolean' || typeof maybe.volume !== 'number' || maybe.volume < 0 || maybe.volume > 1) {
    return DEFAULT_AUDIO_SETTINGS;
  }

  return {
    muted: maybe.muted,
    volume: maybe.volume,
  };
};
