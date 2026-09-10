import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  AudioSettings,
  DEFAULT_AUDIO_SETTINGS,
  setAudioMuted,
  setAudioVolume,
} from '@/lib/audioControls';
import {
  createDisplaySlot,
  isDisplaySlot,
  mediaStreamHasAudio,
  serializePersistentSlots,
  stopMediaStream,
  VideoSlot,
} from '@/lib/displayMedia';
import { AppSession, createAppSession, normalizeAppSession } from '@/lib/session';
import posthog from 'posthog-js';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_GRID_SIZE = 9;
const GRID_SLOT_COUNT = 18;
const SLOT_STORAGE_KEY = 'multiscreenchaturbate-slots';
const PREVIEW_STORAGE_KEY = 'multiscreenchaturbate-preview';

export type { VideoSlot } from '@/lib/displayMedia';

interface ControlsContextInterface {
  gridSize: number;
  setGridSize: (gridSize: number) => void;
  activeVideos: Map<number, boolean>;
  selectedVideo: VideoSlot | null;
  setSelectedVideo: (video: VideoSlot | null) => void;
  slots: (VideoSlot | null)[];
  displayStreams: (MediaStream | null)[];
  audioSettings: AudioSettings[];
  setSlotVideo: (index: number, video: VideoSlot | null) => void;
  startDisplayShare: (index: number) => Promise<boolean>;
  stopDisplayShare: (index: number) => void;
  setSlotMuted: (index: number, muted: boolean) => void;
  setSlotVolume: (index: number, volume: number) => void;
  captureSession: (name: string) => AppSession;
  loadSession: (session: unknown) => AppSession;
  swapPreviewWithSlot: (index: number) => void;
  clearSlot: (index: number) => void;
  isVideoActive: (index: number) => boolean;
  addActiveVideo: (index: number) => void;
  removeActiveVideo: (index: number) => void;
  gridSizeMap: { [key: string]: GridSizeMapInterface };
}

export const ControlsContextProvider = ({ children }: ControlsContextProviderProps) => {
  const { getLocalStorage, setLocalStorage, deleteLocalStorage } = useLocalStorage();
  const [gridSize, setGridSizeHook] = useState<number>(DEFAULT_GRID_SIZE);
  const [activeVideos, setActiveVideos] = useState<Map<number, boolean>>(new Map());
  const [selectedVideo, setSelectedVideoHook] = useState<VideoSlot | null>(null);
  const [slots, setSlotsHook] = useState<(VideoSlot | null)[]>(Array.from({ length: GRID_SLOT_COUNT }, () => null));
  const [displayStreams, setDisplayStreams] = useState<(MediaStream | null)[]>(
    Array.from({ length: GRID_SLOT_COUNT }, () => null)
  );
  const displayStreamsRef = useRef<(MediaStream | null)[]>(Array.from({ length: GRID_SLOT_COUNT }, () => null));
  const [audioSettings, setAudioSettings] = useState<AudioSettings[]>(
    Array.from({ length: GRID_SLOT_COUNT }, () => ({ ...DEFAULT_AUDIO_SETTINGS }))
  );

  useEffect(() => {
    const savedGridSize = getLocalStorage('gridSize');
    if (typeof savedGridSize === 'number') {
      setGridSize(savedGridSize);
    } else {
      setGridSize(DEFAULT_GRID_SIZE);
    }

    const savedSlots = normalizeSlots(getLocalStorage(SLOT_STORAGE_KEY));
    setSlotsHook(savedSlots);

    const savedPreview = normalizeVideoSlot(getLocalStorage(PREVIEW_STORAGE_KEY));
    setSelectedVideoHook(savedPreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorage(SLOT_STORAGE_KEY, serializePersistentSlots(slots));
  }, [setLocalStorage, slots]);

  useEffect(() => () => {
    displayStreamsRef.current.forEach(stopMediaStream);
  }, []);

  useEffect(() => {
    if (selectedVideo) {
      setLocalStorage(PREVIEW_STORAGE_KEY, selectedVideo);
    } else {
      deleteLocalStorage(PREVIEW_STORAGE_KEY);
    }
  }, [deleteLocalStorage, selectedVideo, setLocalStorage]);

  const setGridSize = (newSize: number) => {
    setGridSizeHook(newSize);
    posthog.capture('grid_size_updated', {
      grid_size: newSize,
    });
    setLocalStorage('gridSize', newSize);
  };

  const isVideoActive = (index: number) => activeVideos.has(index);

  const addActiveVideo = (index: number) => {
    const newActiveVideos = new Map(activeVideos);
    newActiveVideos.set(index, true);
    return setActiveVideos(newActiveVideos);
  };

  const removeActiveVideo = (index: number) => {
    const newActiveVideos = new Map(activeVideos);
    newActiveVideos.delete(index);
    return setActiveVideos(newActiveVideos);
  };

  const setSelectedVideo = (video: VideoSlot | null) => {
    setSelectedVideoHook(video);
  };

  const detachDisplayStream = (index: number) => {
    const stream = displayStreamsRef.current[index];
    if (!stream) return;

    const next = [...displayStreamsRef.current];
    next[index] = null;
    displayStreamsRef.current = next;
    setDisplayStreams(next);
    stopMediaStream(stream);
  };

  const setSlotVideo = (index: number, video: VideoSlot | null) => {
    detachDisplayStream(index);
    setSlotsHook((prev) => {
      const next = [...prev];
      next[index] = video;
      return next;
    });
  };

  const clearSlot = (index: number) => {
    detachDisplayStream(index);
    setSlotsHook((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  };

  const stopDisplayShare = (index: number) => {
    detachDisplayStream(index);
    setSlotsHook((prev) => {
      if (!isDisplaySlot(prev[index])) return prev;
      const next = [...prev];
      next[index] = null;
      return next;
    });
  };

  const startDisplayShare = async (index: number) => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Tento prohlížeč nepodporuje App/Window Share.');
    }

    const displayOptions = {
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: 'include',
      windowAudio: 'system',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude',
    } as DisplayMediaStreamOptions;
    const stream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      stopMediaStream(stream);
      throw new Error('Vybraný zdroj neposkytl obraz.');
    }

    const displaySlot = createDisplaySlot(videoTrack);
    detachDisplayStream(index);

    const nextStreams = [...displayStreamsRef.current];
    nextStreams[index] = stream;
    displayStreamsRef.current = nextStreams;
    setDisplayStreams(nextStreams);
    setSlotsHook((prev) => {
      const next = [...prev];
      next[index] = displaySlot;
      return next;
    });

    videoTrack.addEventListener(
      'ended',
      () => {
        if (displayStreamsRef.current[index] !== stream) return;

        const next = [...displayStreamsRef.current];
        next[index] = null;
        displayStreamsRef.current = next;
        setDisplayStreams(next);
        setSlotsHook((prev) => {
          if (prev[index]?.sourceId !== displaySlot.sourceId) return prev;
          const nextSlots = [...prev];
          nextSlots[index] = null;
          return nextSlots;
        });
      },
      { once: true }
    );

    return mediaStreamHasAudio(stream);
  };

  const setSlotMuted = (index: number, muted: boolean) => {
    setAudioSettings((prev) =>
      prev.map((settings, slotIndex) => (slotIndex === index ? setAudioMuted(settings, muted) : settings))
    );
  };

  const setSlotVolume = (index: number, volume: number) => {
    setAudioSettings((prev) =>
      prev.map((settings, slotIndex) => (slotIndex === index ? setAudioVolume(settings, volume) : settings))
    );
  };

  const captureSession = (name: string) => createAppSession({
    name,
    gridSize,
    slots,
    audioSettings,
    selectedVideo,
  });

  const loadSession = (value: unknown) => {
    const session = normalizeAppSession(value);
    displayStreamsRef.current.forEach(stopMediaStream);
    const emptyStreams = Array.from({ length: GRID_SLOT_COUNT }, () => null);
    displayStreamsRef.current = emptyStreams;
    setDisplayStreams(emptyStreams);
    setGridSize(session.gridSize);
    setSlotsHook(session.slots);
    setAudioSettings(session.audioSettings);
    setSelectedVideoHook(session.selectedVideo);
    setActiveVideos(new Map());
    return session;
  };

  const swapPreviewWithSlot = (index: number) => {
    detachDisplayStream(index);
    setSlotsHook((prev) => {
      const next = [...prev];
      const displaced = next[index];
      next[index] = selectedVideo;
      setSelectedVideoHook(isDisplaySlot(displaced) ? null : displaced ?? null);
      return next;
    });
  };

  const gridSizeMap: { [key: string]: GridSizeMapInterface } = useMemo(
    () => ({
      1: uniformGrid(1, 1, 1),
      2: uniformGrid(2, 1, 2),
      3: {
        rows: '2',
        columns: '2',
        elements: [
          { rowStart: '1', rowEnd: 'span 2', colStart: '1', colEnd: 'span 1' },
          { rowStart: '1', rowEnd: 'span 1', colStart: '2', colEnd: 'span 1' },
          { rowStart: '2', rowEnd: 'span 1', colStart: '2', colEnd: 'span 1' },
        ],
      },
      4: uniformGrid(2, 2, 4),
      5: {
        rows: '4',
        columns: '4',
        elements: [
          { rowStart: '1', rowEnd: 'span 4', colStart: '1', colEnd: 'span 3' },
          { rowStart: '1', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
          { rowStart: '2', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
          { rowStart: '3', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
          { rowStart: '4', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
        ],
      },
      6: {
        rows: '3',
        columns: '3',
        elements: [
          { rowStart: '1', rowEnd: 'span 2', colStart: '1', colEnd: 'span 2' },
          { rowStart: '1', rowEnd: 'span 1', colStart: '3', colEnd: 'span 1' },
          { rowStart: '2', rowEnd: 'span 1', colStart: '3', colEnd: 'span 1' },
          { rowStart: '3', rowEnd: 'span 1', colStart: '1', colEnd: 'span 1' },
          { rowStart: '3', rowEnd: 'span 1', colStart: '2', colEnd: 'span 1' },
          { rowStart: '3', rowEnd: 'span 1', colStart: '3', colEnd: 'span 1' },
        ],
      },
      7: {
        rows: '4',
        columns: '4',
        elements: [
          { rowStart: '1', rowEnd: 'span 2', colStart: '1', colEnd: 'span 2' },
          { rowStart: '1', rowEnd: 'span 2', colStart: '3', colEnd: 'span 2' },
          { rowStart: '3', rowEnd: 'span 2', colStart: '1', colEnd: 'span 2' },
          { rowStart: '3', rowEnd: 'span 1', colStart: '3', colEnd: 'span 1' },
          { rowStart: '3', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
          { rowStart: '4', rowEnd: 'span 1', colStart: '3', colEnd: 'span 1' },
          { rowStart: '4', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
        ],
      },
      9: uniformGrid(3, 3, 9),
      10: {
        rows: '4',
        columns: '4',
        elements: [
          { rowStart: '1', rowEnd: 'span 2', colStart: '1', colEnd: 'span 2' },
          { rowStart: '1', rowEnd: 'span 1', colStart: '3', colEnd: 'span 1' },
          { rowStart: '1', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
          { rowStart: '2', rowEnd: 'span 1', colStart: '3', colEnd: 'span 1' },
          { rowStart: '2', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
          { rowStart: '3', rowEnd: 'span 2', colStart: '1', colEnd: 'span 2' },
          { rowStart: '3', rowEnd: 'span 1', colStart: '3', colEnd: 'span 1' },
          { rowStart: '3', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
          { rowStart: '4', rowEnd: 'span 1', colStart: '3', colEnd: 'span 1' },
          { rowStart: '4', rowEnd: 'span 1', colStart: '4', colEnd: 'span 1' },
        ],
      },
      16: uniformGrid(4, 4, 16),
      18: uniformGrid(3, 6, 18),
    }),
    []
  );

  const providerValue: ControlsContextInterface = {
    gridSize,
    setGridSize,
    activeVideos,
    selectedVideo,
    setSelectedVideo,
    slots,
    displayStreams,
    audioSettings,
    setSlotVideo,
    startDisplayShare,
    stopDisplayShare,
    setSlotMuted,
    setSlotVolume,
    captureSession,
    loadSession,
    swapPreviewWithSlot,
    clearSlot,
    isVideoActive,
    addActiveVideo,
    removeActiveVideo,
    gridSizeMap,
  };

  return <ControlsContext.Provider value={providerValue}>{children}</ControlsContext.Provider>;
};

const normalizeVideoSlot = (value: unknown): VideoSlot | null => {
  if (!value || typeof value !== 'object') return null;

  const maybe = value as Partial<VideoSlot>;
  if (maybe.sourceType === 'display' || typeof maybe.url !== 'string' || !maybe.url.trim() || typeof maybe.name !== 'string') return null;

  return {
    name: maybe.name,
    url: maybe.url,
    ...(typeof maybe.playbackUrl === 'string' && /^https?:\/\//i.test(maybe.playbackUrl)
      ? { playbackUrl: maybe.playbackUrl }
      : {}),
  };
};

const normalizeSlots = (value: unknown): (VideoSlot | null)[] => {
  if (!Array.isArray(value)) {
    return Array.from({ length: GRID_SLOT_COUNT }, () => null);
  }

  return Array.from({ length: GRID_SLOT_COUNT }, (_, index) => normalizeVideoSlot(value[index]));
};

interface GridSizeMapInterface {
  rows: string;
  columns: string;
  elements: GridSizeElementInterface[];
}

interface GridSizeElementInterface {
  rowStart: string;
  rowEnd: string;
  colStart: string;
  colEnd: string;
}

const uniformGrid = (rows: number, columns: number, count: number): GridSizeMapInterface => ({
  rows: String(rows),
  columns: String(columns),
  elements: Array.from({ length: count }, (_, index) => ({
    rowStart: String(Math.floor(index / columns) + 1),
    rowEnd: 'span 1',
    colStart: String((index % columns) + 1),
    colEnd: 'span 1',
  })),
});

const ControlsContext = createContext<ControlsContextInterface>({} as ControlsContextInterface);

export const useControlsContext = () => useContext(ControlsContext);

interface ControlsContextProviderProps {
  children: React.ReactNode;
}
