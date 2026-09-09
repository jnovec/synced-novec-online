export interface VideoSlot {
  name: string;
  url: string;
  playbackUrl?: string;
  sourceType?: 'remote' | 'display';
  sourceId?: string;
}

interface DisplayTrackDescriptor {
  id: string;
  label: string;
}

interface StoppableMediaStream {
  getTracks: () => Array<{ stop: () => void }>;
}

interface AudioInspectableMediaStream {
  getAudioTracks: () => unknown[];
}

export const isDisplaySlot = (slot: VideoSlot | null | undefined): boolean =>
  slot?.sourceType === 'display';

export const createDisplaySlot = (track: DisplayTrackDescriptor): VideoSlot => ({
  name: track.label.trim() || 'App/Window Share',
  url: '',
  sourceType: 'display',
  sourceId: track.id,
});

export const serializePersistentSlots = (slots: (VideoSlot | null)[]): (VideoSlot | null)[] =>
  slots.map((slot) => (isDisplaySlot(slot) ? null : slot));

export const stopMediaStream = (stream: StoppableMediaStream | null | undefined) => {
  stream?.getTracks().forEach((track) => track.stop());
};

export const mediaStreamHasAudio = (stream: AudioInspectableMediaStream): boolean =>
  stream.getAudioTracks().length > 0;
