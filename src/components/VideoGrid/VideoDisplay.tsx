import { useButtplugContext } from '@/contexts/useButtplug';
import { useControlsContext } from '@/contexts/useControls';
import { useAudioGamepadVibration } from '@/hooks/useAudioGamepadVibration';
import { useAudioToyVibration } from '@/hooks/useAudioToyVibration';
import { applyMediaAudio } from '@/lib/audioControls';
import { isDisplaySlot } from '@/lib/displayMedia';
import type { VideoSlot } from '@/lib/displayMedia';
import { findVibrationGamepad, vibrateGamepad } from '@/lib/gamepadVibration';
import { normalizeRemoteVideo, resolveRemoteStreamUrl, shouldEmbedRemotePage } from '@/lib/remoteVideo';
import { CloseIcon, RepeatIcon } from '@chakra-ui/icons';
import {
  Badge,
  Box,
  Button,
  Flex,
  GridItem,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Portal,
  Select,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Spinner,
  Text,
  useToast,
} from '@chakra-ui/react';
import { DragEvent, useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import { DisplayMediaPlayer } from './DisplayMediaPlayer';

const DUPLICATE_SOURCE_EVENT = 'synced:duplicate-source-highlight';
const SLOT_DRAG_TYPE = 'application/x-synced-slot-index';
const STREAM_RESOLVE_ATTEMPTS = 3;
const PLAYBACK_STALL_MS = 12_000;
const PLAYBACK_WATCH_INTERVAL_MS = 4_000;
const PLAYBACK_RETRY_COOLDOWN_MS = 15_000;
const SLOT_AVAILABILITY_EVENT = 'synced:slot-availability';
const SLOT_LAYOUT_RELOAD_EVENT = 'synced:slot-layout-reload';
const isHlsPlaybackUrl = (url: string) => /\.m3u8(?:$|[?#])/i.test(url);

const waitFor = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

interface VideoDisplayProps {
  index: number;
  onOpenFullscreen: (index: number | null) => void;
  isFullscreenActive: boolean;
  gridRowStart: string;
  gridRowEnd: string;
  gridColumnStart: string;
  gridColumnEnd: string;
}

export const VideoDisplay = ({
  index,
  onOpenFullscreen,
  isFullscreenActive,
  gridRowStart,
  gridRowEnd,
  gridColumnStart,
  gridColumnEnd,
}: VideoDisplayProps) => {
  const toast = useToast();
  const {
    slots,
    displayStreams,
    selectedVideo,
    audioSettings,
    setSlotVideo,
    swapSlots,
    startDisplayShare,
    stopDisplayShare,
    clearSlot,
    setSlotMuted,
    setSlotVolume,
  } = useControlsContext();
  const slot = slots[index];
  const displayStream = displayStreams[index];
  const isDisplay = isDisplaySlot(slot);
  const activeRemoteStreamCount = slots.filter((candidate) => candidate?.url && !isDisplaySlot(candidate)).length;
  const isBusyGrid = activeRemoteStreamCount > 4;
  const audio = audioSettings[index];
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'loading' | 'live' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const slotKeyRef = useRef<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSlotDragOver, setIsSlotDragOver] = useState(false);
  const [isSlotDragging, setIsSlotDragging] = useState(false);
  const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [sharingDisplay, setSharingDisplay] = useState(false);
  const [gamepadVibrationEnabled, setGamepadVibrationEnabled] = useState(false);
  const [vibrationSensitivity, setVibrationSensitivity] = useState(2.4);
  const [toyVibrationEnabled, setToyVibrationEnabled] = useState(false);
  const [toySensitivity, setToySensitivity] = useState(2.4);
  const [selectedToyIndex, setSelectedToyIndex] = useState<number | null>(null);
  const [isDuplicateHighlighted, setIsDuplicateHighlighted] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [videoReversing, setVideoReversing] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopSeconds, setLoopSeconds] = useState(30);
  const [loopStart, setLoopStart] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const mediaRootRef = useRef<HTMLDivElement>(null);
  const slotPlayerRef = useRef<ReactPlayer>(null);
  const reverseTimerRef = useRef<number | null>(null);
  const playbackFailuresRef = useRef(0);
  const previewReadyRef = useRef(false);
  const lastPlaybackProgressRef = useRef(0);
  const recoveryPendingRef = useRef(false);
  const nextRecoveryAtRef = useRef(0);
  const { status: buttplugStatus, devices: toyDevices, vibrateDevice, stopDevice } = useButtplugContext();
  const { status: vibrationStatus, level: vibrationLevel } = useAudioGamepadVibration({
    stream: isDisplay ? displayStream : null,
    enabled: gamepadVibrationEnabled,
    sensitivity: vibrationSensitivity,
  });
  const { status: toyVibrationStatus, level: toyVibrationLevel } = useAudioToyVibration({
    stream: isDisplay ? displayStream : null,
    enabled: toyVibrationEnabled,
    sensitivity: toySensitivity,
    deviceIndex: selectedToyIndex,
  });

  useEffect(() => {
    if (!isDisplay || !displayStream) setGamepadVibrationEnabled(false);
  }, [displayStream, isDisplay]);

  useEffect(() => {
    if (!isDisplay || !displayStream) setToyVibrationEnabled(false);
  }, [displayStream, isDisplay]);

  useEffect(() => {
    setVideoPlaying(true);
    setVideoReversing(false);
    setLoopEnabled(false);
    setLoopStart(0);
    setVideoDuration(0);
    setVideoCurrentTime(0);
  }, [slot?.url, slot?.playbackUrl]);

  useEffect(() => () => {
    if (reverseTimerRef.current !== null) window.clearInterval(reverseTimerRef.current);
  }, []);

  useEffect(() => {
    if (selectedToyIndex !== null && !toyDevices.some((device) => device.index === selectedToyIndex)) setSelectedToyIndex(null);
  }, [selectedToyIndex, toyDevices]);

  useEffect(() => {
    const handleDuplicateHighlight = (event: Event) => {
      const detail = (event as CustomEvent<{ slotIndexes?: number[] }>).detail;
      setIsDuplicateHighlighted(Boolean(detail?.slotIndexes?.includes(index)));
    };

    window.addEventListener(DUPLICATE_SOURCE_EVENT, handleDuplicateHighlight);
    return () => window.removeEventListener(DUPLICATE_SOURCE_EVENT, handleDuplicateHighlight);
  }, [index]);

  useEffect(() => {
    const reloadSlot = () => setReloadKey((key) => key + 1);
    window.addEventListener(SLOT_LAYOUT_RELOAD_EVENT, reloadSlot);
    return () => window.removeEventListener(SLOT_LAYOUT_RELOAD_EVENT, reloadSlot);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!slot?.url || isDisplay) {
      setResolvedUrl(null);
      setLoading(false);
      setStreamStatus(isDisplay ? 'live' : 'error');
      return;
    }

    setLoading(true);
    setStreamStatus('loading');
    const slotKey = `${slot.url}\n${slot.playbackUrl ?? ''}`;
    if (slotKeyRef.current !== slotKey) {
      slotKeyRef.current = slotKey;
      setResolvedUrl(null);
    }

    const resolveStream = async () => {
      for (let attempt = 1; attempt <= STREAM_RESOLVE_ATTEMPTS; attempt += 1) {
        try {
          const streamUrl = await resolveRemoteStreamUrl(slot.url, slot.playbackUrl);
          if (cancelled) return;
          if (streamUrl || shouldEmbedRemotePage(slot.url)) {
            window.dispatchEvent(new CustomEvent(SLOT_AVAILABILITY_EVENT, { detail: { index, available: true } }));
            setResolvedUrl(streamUrl);
            setLoading(false);
            setStreamStatus('loading');
            recoveryPendingRef.current = false;
            lastPlaybackProgressRef.current = Date.now();
            return;
          }
        } catch {
          // Stream URLs are short-lived and can be rotated while a tile opens.
        }

        if (attempt < STREAM_RESOLVE_ATTEMPTS) await waitFor(700 * attempt);
      }

      if (!cancelled) {
        window.dispatchEvent(new CustomEvent(SLOT_AVAILABILITY_EVENT, { detail: { index, available: false } }));
        setLoading(false);
        setStreamStatus('error');
        recoveryPendingRef.current = false;
      }
    };

    void resolveStream();

    return () => {
      cancelled = true;
    };
  }, [index, isDisplay, reloadKey, slot?.playbackUrl, slot?.url]);

  useEffect(() => {
    playbackFailuresRef.current = 0;
    previewReadyRef.current = false;
    recoveryPendingRef.current = false;
    nextRecoveryAtRef.current = 0;
  }, [slot?.playbackUrl, slot?.url]);

  const refreshStalledStream = () => {
    const now = Date.now();
    if (recoveryPendingRef.current || now < nextRecoveryAtRef.current || !slot?.url || isDisplay) return;
    recoveryPendingRef.current = true;
    playbackFailuresRef.current += 1;
    nextRecoveryAtRef.current = now + Math.min(60_000, PLAYBACK_RETRY_COOLDOWN_MS * 2 ** Math.min(playbackFailuresRef.current - 1, 2));
    setReloadKey((current) => current + 1);
  };

  const handlePlayerProgress = () => {
    lastPlaybackProgressRef.current = Date.now();
    playbackFailuresRef.current = 0;
    nextRecoveryAtRef.current = 0;
    if (!previewReadyRef.current) {
      previewReadyRef.current = true;
      window.dispatchEvent(new CustomEvent('synced:slot-playing', { detail: { index } }));
    }
  };

  useEffect(() => {
    if (!resolvedUrl || isDisplay) return;

    lastPlaybackProgressRef.current = Date.now();
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastPlaybackProgressRef.current >= PLAYBACK_STALL_MS) refreshStalledStream();
    }, PLAYBACK_WATCH_INTERVAL_MS);

    return () => window.clearInterval(watchdog);
  }, [isDisplay, resolvedUrl]);

  const handleClick = () => {
    if (slot) {
      onOpenFullscreen(isFullscreenActive ? null : index);
      return;
    }

    setManualUrl(selectedVideo?.url ?? '');
    setIsUrlDialogOpen(true);
  };

  const placeRemoteVideo = (video: VideoSlot, fromManualDialog = false) => {
    const duplicateSlotIndexes = findDuplicateSlotIndexes(slots, index, video);
    if (!duplicateSlotIndexes.length) {
      setSlotVideo(index, video);
      if (fromManualDialog) setIsUrlDialogOpen(false);
      return;
    }

    if (fromManualDialog) setIsUrlDialogOpen(false);
    dispatchDuplicateHighlight(duplicateSlotIndexes);

    window.setTimeout(() => {
      const slotLabels = duplicateSlotIndexes.map((slotIndex) => `Slot ${slotIndex + 1}`).join(', ');
      const confirmed = window.confirm(
        `Zdroj „${video.name}“ už běží (${slotLabels}).\n\nOpravdu ho chceš přidat znovu do Slotu ${index + 1}?`
      );

      if (confirmed) {
        setSlotVideo(index, video);
      } else if (fromManualDialog) {
        setIsUrlDialogOpen(true);
      }

      dispatchDuplicateHighlight([]);
    }, 80);
  };

  const handleSlotDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!slot) {
      event.preventDefault();
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, [role="slider"]')) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(SLOT_DRAG_TYPE, String(index));
    event.dataTransfer.setData('text/plain', slot.name);
    setIsSlotDragging(true);
  };

  const handleSlotDragEnd = () => {
    setIsSlotDragging(false);
    setIsDragOver(false);
    setIsSlotDragOver(false);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const isSlotMove = Array.from(event.dataTransfer.types).includes(SLOT_DRAG_TYPE);
    event.dataTransfer.dropEffect = isSlotMove ? 'move' : 'copy';
    setIsSlotDragOver(isSlotMove);
    setIsDragOver(!isSlotMove);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
    setIsSlotDragOver(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    setIsSlotDragOver(false);

    const draggedSlotValue = event.dataTransfer.getData(SLOT_DRAG_TYPE);
    if (draggedSlotValue) {
      const fromIndex = Number.parseInt(draggedSlotValue, 10);
      if (Number.isInteger(fromIndex) && fromIndex >= 0 && fromIndex < slots.length && fromIndex !== index) {
        swapSlots(fromIndex, index);
        toast({
          title: `Slot ${fromIndex + 1} ↔ Slot ${index + 1}`,
          description: 'Pozice oken byly prohozeny.',
          status: 'success',
          duration: 1400,
          isClosable: false,
        });
      }
      return;
    }

    const url =
      event.dataTransfer.getData('videoUrl') ||
      event.dataTransfer.getData('text/uri-list') ||
      event.dataTransfer.getData('text/plain');
    const suppliedName = event.dataTransfer.getData('videoName');
    const playbackUrl = event.dataTransfer.getData('videoPlaybackUrl');
    const thumbnailUrl = event.dataTransfer.getData('videoThumbnailUrl');
    const video = normalizeRemoteVideo(url, suppliedName, playbackUrl, thumbnailUrl);

    if (!video) {
      toast({
        title: 'Neplatný stream',
        description: 'Přetáhni platnou HTTP nebo HTTPS adresu streamu.',
        status: 'warning',
        duration: 2800,
        isClosable: true,
      });
      return;
    }

    placeRemoteVideo(video);
  };

  const handleManualUrlSubmit = () => {
    const video = normalizeRemoteVideo(manualUrl);
    if (!video) {
      toast({
        title: 'Neplatný stream',
        description: 'Zadej platnou HTTP nebo HTTPS adresu.',
        status: 'warning',
        duration: 2800,
        isClosable: true,
      });
      return;
    }

    placeRemoteVideo(video, true);
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('clipboard_unavailable');
      const clipboardText = (await navigator.clipboard.readText()).trim();
      if (!clipboardText) {
        toast({ title: 'Schránka je prázdná', status: 'info', duration: 2200 });
        return;
      }
      setManualUrl(clipboardText);
    } catch {
      toast({
        title: 'Schránku se nepodařilo načíst',
        description: 'Povol přístup ke schránce v prohlížeči nebo vlož URL klávesovou zkratkou.',
        status: 'warning',
        duration: 4000,
        isClosable: true,
      });
    }
  };

  const handleStartDisplayShare = async () => {
    setSharingDisplay(true);
    try {
      const hasAudio = await startDisplayShare(index);
      setIsUrlDialogOpen(false);
      toast({
        title: hasAudio ? 'Sdílení okna se zvukem spuštěno' : 'Okno se sdílí bez zvuku',
        description: hasAudio ? undefined : 'V dialogu Chromu zapni „Sdílet se systémovým zvukem“ a zdroj vyber znovu.',
        status: hasAudio ? 'success' : 'warning',
        duration: hasAudio ? 2200 : 5000,
        isClosable: true,
      });
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'NotAllowedError';
      toast({
        title: cancelled ? 'Výběr okna byl zrušen' : 'Sdílení nelze spustit',
        description: cancelled ? undefined : error instanceof Error ? error.message : 'Prohlížeč odmítl sdílení okna.',
        status: cancelled ? 'info' : 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setSharingDisplay(false);
    }
  };

  const handleToggleAudio = () => {
    const nextMuted = !audio.muted;
    const media = mediaRootRef.current?.querySelector('video');
    if (media) {
      void applyMediaAudio(media, { muted: nextMuted, volume: audio.volume }).catch(() => {
        toast({
          title: 'Prohlížeč zvuk zablokoval',
          description: 'Klikni na Zvuk ještě jednou nebo otevři stream na celou obrazovku.',
          status: 'warning',
          duration: 3000,
          isClosable: true,
        });
      });
    }
    setSlotMuted(index, nextMuted);
  };

  const handleVolumeChange = (value: number) => {
    const volume = value / 100;
    const media = mediaRootRef.current?.querySelector('video');
    if (media) media.volume = volume;
    setSlotVolume(index, volume);
  };

  const handleVibrationToggle = () => {
    const nextEnabled = !gamepadVibrationEnabled;
    setGamepadVibrationEnabled(nextEnabled);
    if (!nextEnabled) return;

    if (!findVibrationGamepad()) {
      toast({
        title: 'Gamepad nebyl nalezen',
        description: 'Připoj ovladač a stiskni na něm libovolné tlačítko, potom vibrace zapni znovu.',
        status: 'warning',
        duration: 4200,
        isClosable: true,
      });
    }
    if (!displayStream?.getAudioTracks().length) {
      toast({
        title: 'Sdílené okno nemá zvukovou stopu',
        description: 'Vyber zdroj znovu a v dialogu Chromu zapni sdílení zvuku.',
        status: 'warning',
        duration: 4200,
        isClosable: true,
      });
    }
  };

  const handleVibrationTest = () => {
    const gamepad = findVibrationGamepad();
    if (!gamepad) {
      toast({ title: 'Gamepad nebyl nalezen', status: 'warning', duration: 2500, isClosable: true });
      return;
    }
    void vibrateGamepad(gamepad, { duration: 500, strongMagnitude: 0.8, weakMagnitude: 0.55 }).catch(() => {
      toast({ title: 'Prohlížeč vibraci nepovolil', status: 'error', duration: 2800, isClosable: true });
    });
  };

  const handleToyToggle = () => {
    if (!toyVibrationEnabled && buttplugStatus !== 'connected') {
      toast({ title: 'Bluetooth hračka není připojená', description: 'Připoj ji v Nastavení → Hračky (Bluetooth).', status: 'warning', duration: 3500 });
      return;
    }
    if (!toyVibrationEnabled && !toyDevices.length) {
      toast({ title: 'Hračka nebyla nalezena', description: 'Spusť skenování v Nastavení → Hračky.', status: 'warning', duration: 3500 });
      return;
    }
    setToyVibrationEnabled((value) => !value);
  };

  const handleToyTest = () => {
    const target = selectedToyIndex ?? toyDevices[0]?.index;
    if (target === undefined) return;
    void vibrateDevice(target, 0.8).then(() => window.setTimeout(() => void stopDevice(target), 600));
  };

  return (
    <>
      <GridItem
        data-synced-slot-index={index}
        w="full"
        h="full"
        minH={0}
        minW={0}
        gridRowStart={gridRowStart}
        gridRowEnd={gridRowEnd}
        gridColumnStart={gridColumnStart}
        gridColumnEnd={gridColumnEnd}
        borderWidth={isDuplicateHighlighted || isSlotDragOver ? '3px' : '1px'}
        borderColor={
          isDuplicateHighlighted
            ? 'red.500'
            : isSlotDragOver
              ? 'cyan.300'
              : isDragOver
                ? 'red.300'
                : slot
                  ? 'whiteAlpha.300'
                  : 'whiteAlpha.100'
        }
        overflow="hidden"
        pos="relative"
        position={isFullscreenActive ? 'fixed' : 'relative'}
        inset={isFullscreenActive ? '0' : undefined}
        zIndex={isFullscreenActive ? 1000 : (isDuplicateHighlighted || isSlotDragOver ? 12 : 0)}
        borderRadius={isFullscreenActive ? '0' : 'lg'}
        bg="black"
        opacity={isSlotDragging ? 0.55 : 1}
        boxShadow={
          isDuplicateHighlighted
            ? '0 0 0 2px rgba(229,62,62,.8), 0 0 34px rgba(229,62,62,.75)'
            : isSlotDragOver
              ? '0 0 0 2px rgba(103,232,249,.65), 0 0 30px rgba(34,211,238,.5)'
              : undefined
        }
        transform="scale(1)"
        transformOrigin="center"
        transition="transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease, border-color 220ms ease, opacity 160ms ease"
        willChange="transform"
        draggable={Boolean(slot)}
        onDragStart={handleSlotDragStart}
        onDragEnd={handleSlotDragEnd}
          _hover={{
          transform: 'scale(1.16)',
          zIndex: 10,
          borderColor: 'red.300',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(252, 129, 129, 0.42)',
        }}
        _focusVisible={{
          outline: '2px solid',
          outlineColor: 'red.300',
          outlineOffset: '3px',
          zIndex: 10,
        }}
        onClick={handleClick}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        cursor={slot ? 'grab' : 'pointer'}
      >
        {slot ? (
          <Box ref={mediaRootRef} position="absolute" inset={0} opacity={1} pointerEvents="auto">
            {isDisplay && displayStream ? (
              <DisplayMediaPlayer
                stream={displayStream}
                muted={audio.muted}
                volume={audio.volume}
              />
            ) : loading && !resolvedUrl ? (
              <Flex h="full" alignItems="center" justifyContent="center" direction="column" gap="2" color="gray.400">
                <Spinner size="sm" />
                <Text fontSize="xs">Načítám…</Text>
              </Flex>
            ) : resolvedUrl ? (
              <>
              <ReactPlayer
                ref={slotPlayerRef}
                width="100%"
                height="100%"
                url={resolvedUrl}
                playing={videoPlaying && !videoReversing}
                muted={audio.muted}
                volume={audio.volume}
                config={{
                  file: {
                    forceHLS: true,
                    attributes: {
                      crossOrigin: 'true',
                    },
                    hlsOptions: {
                      lowLatencyMode: false,
                      liveSyncDurationCount: 3,
                      liveMaxLatencyDurationCount: 10,
                      startLevel: -1,
                      capLevelToPlayerSize: !isFullscreenActive,
                      abrEwmaDefaultEstimate: isFullscreenActive ? 8_000_000 : (isBusyGrid ? 1_250_000 : 2_000_000),
                      maxBufferLength: isFullscreenActive ? 30 : (isBusyGrid ? 8 : 14),
                      maxMaxBufferLength: isFullscreenActive ? 90 : (isBusyGrid ? 16 : 30),
                      manifestLoadingMaxRetry: 4,
                      levelLoadingMaxRetry: 4,
                      fragLoadingMaxRetry: 6,
                      fragLoadingRetryDelay: 800,
                    },
                  },
                }}
                onError={() => {
                  setStreamStatus('error');
                  window.dispatchEvent(new CustomEvent(SLOT_AVAILABILITY_EVENT, { detail: { index, available: false } }));
                  refreshStalledStream();
                }}
                onBuffer={() => setStreamStatus('loading')}
                onDuration={(duration) => setVideoDuration(Number.isFinite(duration) ? duration : 0)}
                onProgress={(state) => {
                  setStreamStatus('live');
                  handlePlayerProgress();
                  setVideoCurrentTime(Number.isFinite(state.playedSeconds) ? state.playedSeconds : 0);
                  if (!loopEnabled || videoDuration <= 0) return;
                  const end = Math.min(videoDuration, loopStart + loopSeconds);
                  if (state.playedSeconds >= end || state.playedSeconds < loopStart) slotPlayerRef.current?.seekTo(loopStart, 'seconds');
                }}
                onEnded={() => {
                  if (loopEnabled) {
                    slotPlayerRef.current?.seekTo(loopStart, 'seconds');
                    setVideoPlaying(true);
                  } else {
                    setVideoPlaying(false);
                  }
                }}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              />
              {isFullscreenActive && !isDisplay && (
                <Portal>
                  <Flex
                    position="fixed"
                    top="24px"
                    left="24px"
                    zIndex={2000}
                    alignItems="center"
                    gap="1"
                    bg="#050505"
                    border="2px solid"
                    borderColor="purple.300"
                    borderRadius="lg"
                    boxShadow="0 0 0 2px rgba(168,85,247,.45), 0 8px 28px rgba(0,0,0,.9)"
                    p="2"
                    flexWrap="wrap"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Text color="purple.200" fontSize="xs" fontWeight="bold" mr="1">VIDEO</Text>
                    <Button size="xs" colorScheme="blue" onClick={() => setVideoPlaying((playing) => !playing)}>{videoPlaying ? 'Pause' : 'Play'}</Button>
                    <Button size="xs" colorScheme={videoReversing ? 'orange' : 'gray'} onClick={() => setVideoReversing((reversing) => {
                      if (reversing) {
                        if (reverseTimerRef.current !== null) window.clearInterval(reverseTimerRef.current);
                        reverseTimerRef.current = null;
                        return false;
                      }
                      reverseTimerRef.current = window.setInterval(() => {
                        const current = slotPlayerRef.current?.getCurrentTime() ?? videoCurrentTime;
                        const next = Math.max(0, current - 0.2);
                        slotPlayerRef.current?.seekTo(next, 'seconds');
                        setVideoCurrentTime(next);
                        if (next <= 0) {
                          if (reverseTimerRef.current !== null) window.clearInterval(reverseTimerRef.current);
                          reverseTimerRef.current = null;
                          setVideoReversing(false);
                        }
                      }, 100);
                      return true;
                    })}>Reverse</Button>
                    <Button size="xs" colorScheme={loopEnabled ? 'purple' : 'gray'} onClick={() => { setLoopStart(slotPlayerRef.current?.getCurrentTime() ?? loopStart); setLoopEnabled((enabled) => !enabled); }}>LOOP</Button>
                    <Input aria-label="Délka fullscreen smyčky" value={loopSeconds} onChange={(event) => setLoopSeconds(Math.max(1, Number(event.target.value) || 1))} type="number" min={1} max={3600} size="xs" w="58px" bg="gray.900" color="white" textColor="white" sx={{ WebkitTextFillColor: 'white' }} />
                    <Button size="xs" onClick={() => setLoopStart((start) => Math.max(0, start - 0.5))}>&lt;</Button>
                    <Text color="gray.300" fontSize="10px" minW="42px" textAlign="center">{loopStart.toFixed(1)}s</Text>
                    <Button size="xs" onClick={() => setLoopStart((start) => Math.min(Math.max(0, videoDuration - loopSeconds), start + 0.5))}>&gt;</Button>
                    {videoDuration > 0 && Number.isFinite(videoDuration) && (
                      <Flex alignItems="center" gap="1" w="full" minW="220px" px="1">
                        <Text color="gray.300" fontSize="10px" minW="34px" textAlign="right">
                          {Math.floor(videoCurrentTime / 60)}:{String(Math.floor(videoCurrentTime % 60)).padStart(2, '0')}
                        </Text>
                        <Slider
                          aria-label="Posun videa"
                          value={Math.min(videoCurrentTime, videoDuration)}
                          min={0}
                          max={videoDuration}
                          step={0.1}
                          onChange={(value) => {
                            setVideoCurrentTime(value);
                            slotPlayerRef.current?.seekTo(value, 'seconds');
                          }}
                          colorScheme="purple"
                        >
                          <SliderTrack bg="whiteAlpha.300"><SliderFilledTrack /></SliderTrack>
                          <SliderThumb />
                        </Slider>
                        <Text color="gray.300" fontSize="10px" minW="34px">
                          {Math.floor(videoDuration / 60)}:{String(Math.floor(videoDuration % 60)).padStart(2, '0')}
                        </Text>
                      </Flex>
                    )}
                  </Flex>
                </Portal>
              )}
              </>
            ) : slot && shouldEmbedRemotePage(slot.url) ? (
              <Box
                as="iframe"
                title={slot.name}
                src={slot.url}
                position="absolute"
                inset={0}
                w="100%"
                h="100%"
                border="0"
                sandbox="allow-scripts allow-forms allow-popups allow-presentation"
                referrerPolicy="no-referrer"
                pointerEvents="none"
              />
            ) : (
              <Flex h="full" alignItems="center" justifyContent="center" color="gray.400">
                <Text fontSize="xs">Zdroj není dostupný.</Text>
              </Flex>
            )}
            <Flex position="absolute" top="2" right="2" alignItems="center" gap="1" flexWrap="wrap" justifyContent="flex-end">
              <Badge colorScheme={isDisplay ? 'purple' : 'green'} fontSize="0.65rem">
                {isDisplay ? 'APP' : `SLOT ${index + 1}`}
              </Badge>
              <Button
                size="xs"
                h="20px"
                px="2"
                colorScheme="purple"
                isLoading={sharingDisplay}
                loadingText="…"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleStartDisplayShare();
                }}
                aria-label={`${isDisplay ? 'Vyměnit' : 'Sdílet'} okno aplikace ve slotu ${index + 1}`}
              >
                {isDisplay ? 'Vyměnit' : 'Okno'}
              </Button>
              {isDisplay ? (
                <Button
                  size="xs"
                  minW="38px"
                  h="20px"
                  px="2"
                  colorScheme="red"
                  onClick={(event) => {
                    event.stopPropagation();
                    stopDisplayShare(index);
                  }}
                  aria-label={`Zastavit sdílení ve slotu ${index + 1}`}
                >
                  Stop
                </Button>
              ) : (
                <IconButton
                  aria-label={`Zastavit stream ve slotu ${index + 1}`}
                  icon={<CloseIcon boxSize="2" />}
                  size="xs"
                  minW="20px"
                  h="20px"
                  colorScheme="red"
                  variant="solid"
                  onClick={(event) => {
                    event.stopPropagation();
                    clearSlot(index);
                  }}
                />
              )}
            </Flex>
            {isDisplay && (
              <Flex
                position="absolute"
                left="2"
                top="2"
                alignItems="center"
                gap="2"
                bg="blackAlpha.800"
                backdropFilter="blur(4px)"
                px="2"
                py="1"
                borderRadius="md"
                onClick={(event) => event.stopPropagation()}
              >
                <Button
                  size="xs"
                  h="20px"
                  px="2"
                  colorScheme={gamepadVibrationEnabled ? 'pink' : 'gray'}
                  onClick={handleVibrationToggle}
                >
                  {gamepadVibrationEnabled ? 'Vibrace ON' : 'Vibrace'}
                </Button>
                <Button size="xs" h="20px" px="2" variant="outline" colorScheme="pink" onClick={handleVibrationTest}>
                  Test
                </Button>
                <Slider
                  aria-label={`Citlivost vibrací slotu ${index + 1}`}
                  value={vibrationSensitivity * 10}
                  onChange={(value) => setVibrationSensitivity(value / 10)}
                  min={5}
                  max={50}
                  step={1}
                  w="60px"
                  focusThumbOnChange={false}
                >
                  <SliderTrack bg="whiteAlpha.400">
                    <SliderFilledTrack bg="pink.300" />
                  </SliderTrack>
                  <SliderThumb boxSize="10px" />
                </Slider>
                {gamepadVibrationEnabled && (
                  <Badge colorScheme={vibrationStatus === 'running' ? 'green' : 'orange'} fontSize="0.6rem">
                    {vibrationStatus === 'running' ? `${Math.round(vibrationLevel * 100)}%` : vibrationStatus}
                  </Badge>
                )}
                <Button size="xs" h="20px" px="2" colorScheme={toyVibrationEnabled ? 'purple' : 'gray'} onClick={handleToyToggle}>
                  {toyVibrationEnabled ? 'Hračka ON' : 'Hračka'}
                </Button>
                <Button size="xs" h="20px" px="2" variant="outline" colorScheme="purple" onClick={handleToyTest} isDisabled={!toyDevices.length}>
                  Test
                </Button>
                {toyDevices.length > 1 && (
                  <Select size="xs" w="110px" value={selectedToyIndex ?? ''} onChange={(event) => setSelectedToyIndex(event.target.value ? Number(event.target.value) : null)} aria-label="Hračka pro slot">
                    <option value="">Auto</option>
                    {toyDevices.map((device) => <option key={device.index} value={device.index}>{device.name}</option>)}
                  </Select>
                )}
                <Slider aria-label={`Citlivost hračky slotu ${index + 1}`} value={toySensitivity * 10} onChange={(value) => setToySensitivity(value / 10)} min={5} max={50} step={1} w="60px" focusThumbOnChange={false}>
                  <SliderTrack bg="whiteAlpha.400"><SliderFilledTrack bg="purple.300" /></SliderTrack><SliderThumb boxSize="10px" />
                </Slider>
                {toyVibrationEnabled && <Badge colorScheme={toyVibrationStatus === 'running' ? 'green' : 'orange'} fontSize="0.6rem">{toyVibrationStatus === 'running' ? `${Math.round(toyVibrationLevel * 100)}%` : toyVibrationStatus}</Badge>}
              </Flex>
            )}
            <Flex
              position="absolute"
              left="2"
              right="2"
              bottom="2"
              justifyContent="space-between"
              alignItems="center"
              gap="2"
              bg="blackAlpha.700"
              backdropFilter="blur(4px)"
              px="2"
              py="1"
              borderRadius="md"
            >
              <Flex alignItems="center" gap="1" minW={0}>
                <Box
                  boxSize="8px"
                  borderRadius="full"
                  bg={streamStatus === 'live' ? 'green.300' : streamStatus === 'error' ? 'red.400' : 'orange.300'}
                  title={streamStatus === 'live' ? 'Stream běží' : streamStatus === 'error' ? 'Stream není dostupný' : 'Stream se načítá'}
                  flexShrink={0}
                />
                <Text color="#EEEEEC" fontSize="xs" noOfLines={1} minW={0}>
                {slot.name}
                </Text>
              </Flex>
              <Flex
                alignItems="center"
                gap="2"
                flexShrink={0}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Ovládání zvuku pro slot ${index + 1}`}
              >
                {streamStatus === 'error' && (
                  <IconButton
                    size="xs"
                    h="20px"
                    minW="20px"
                    aria-label={`Obnovit stream ve slotu ${index + 1}`}
                    icon={<RepeatIcon />}
                    onClick={() => setReloadKey((key) => key + 1)}
                  />
                )}
                <Button
                  size="xs"
                  minW="44px"
                  h="20px"
                  px="2"
                  colorScheme={audio.muted ? 'gray' : 'green'}
                  onClick={handleToggleAudio}
                  aria-label={audio.muted ? `Zapnout zvuk ve slotu ${index + 1}` : `Ztlumit slot ${index + 1}`}
                >
                  {audio.muted ? 'Zvuk' : 'Mute'}
                </Button>
                <Slider
                  aria-label={`Hlasitost slotu ${index + 1}`}
                  value={audio.volume * 100}
                  onChange={handleVolumeChange}
                  min={0}
                  max={100}
                  step={1}
                  w="64px"
                  focusThumbOnChange={false}
                >
                  <SliderTrack bg="whiteAlpha.400">
                    <SliderFilledTrack bg={audio.muted ? 'gray.400' : 'green.300'} />
                  </SliderTrack>
                  <SliderThumb boxSize="10px" />
                </Slider>
              </Flex>
            </Flex>
          </Box>
        ) : (
          <Flex h="full" px="2" alignItems="center" justifyContent="center" direction="column" gap="2" color="gray.500" textAlign="center">
            <Text fontSize="sm" fontWeight="medium">
              Slot {index + 1}
            </Text>
            <Text fontSize="xs">Vyber vzdálený stream nebo lokální okno aplikace.</Text>
            <Flex gap="2" flexWrap="wrap" justifyContent="center">
              <Button
                size="xs"
                variant="outline"
                colorScheme="gray"
                onClick={(event) => {
                  event.stopPropagation();
                  setManualUrl(selectedVideo?.url ?? '');
                  setIsUrlDialogOpen(true);
                }}
              >
                URL stream
              </Button>
              <Button
                size="xs"
                colorScheme="purple"
                isLoading={sharingDisplay}
                loadingText="Výběr…"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleStartDisplayShare();
                }}
              >
                App/Window Share
              </Button>
            </Flex>
          </Flex>
        )}

        {isSlotDragOver && (
          <Box
            position="absolute"
            inset={0}
            zIndex={29}
            pointerEvents="none"
            bg="rgba(34, 211, 238, 0.13)"
            boxShadow="inset 0 0 0 4px rgba(103, 232, 249, 0.9)"
          >
            <Badge position="absolute" top="2" left="2" colorScheme="cyan" fontSize="0.72rem" px="2" py="1">
              PUSTIT SEM · SLOT {index + 1}
            </Badge>
          </Box>
        )}

        {isDuplicateHighlighted && (
          <Box
            position="absolute"
            inset={0}
            zIndex={30}
            pointerEvents="none"
            bg="rgba(229, 62, 62, 0.20)"
            boxShadow="inset 0 0 0 4px rgba(245, 101, 101, 0.95)"
          >
            <Badge position="absolute" top="2" left="2" colorScheme="red" fontSize="0.72rem" px="2" py="1">
              DUPLICITA · SLOT {index + 1}
            </Badge>
          </Box>
        )}
      </GridItem>

      <Modal isOpen={isUrlDialogOpen} onClose={() => setIsUrlDialogOpen(false)} isCentered>
        <ModalOverlay />
        <ModalContent bg="#111" color="#EEEEEC" borderWidth="1px" borderColor="whiteAlpha.300">
          <ModalHeader>Stream pro slot {index + 1}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text fontSize="sm" color="gray.400" mb="3">
              Zadej URL stránky, HLS nebo video soubor.
            </Text>
            <Input
              autoFocus
              value={manualUrl}
              onChange={(event) => setManualUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleManualUrlSubmit();
              }}
              placeholder="https://example.com/live/stream"
              color="#EEEEEC"
              _placeholder={{ color: 'whiteAlpha.600' }}
              bg="black"
              borderColor="whiteAlpha.400"
            />
          </ModalBody>
          <ModalFooter gap="2" flexWrap="wrap">
            <Button colorScheme="cyan" bg="cyan.400" color="gray.900" _hover={{ bg: 'cyan.300' }} onClick={() => void handlePasteFromClipboard()}>
              Vložit ze schránky
            </Button>
            <Button
              colorScheme="purple"
              mr="auto"
              isLoading={sharingDisplay}
              loadingText="Vybírám…"
              onClick={() => void handleStartDisplayShare()}
            >
              App/Window Share
            </Button>
            <Button variant="ghost" onClick={() => setIsUrlDialogOpen(false)}>
              Zrušit
            </Button>
            <Button colorScheme="red" onClick={handleManualUrlSubmit} isDisabled={!manualUrl.trim()}>
              Načíst stream
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

const dispatchDuplicateHighlight = (slotIndexes: number[]) => {
  window.dispatchEvent(new CustomEvent(DUPLICATE_SOURCE_EVENT, { detail: { slotIndexes } }));
};

const findDuplicateSlotIndexes = (slots: (VideoSlot | null)[], targetIndex: number, incoming: VideoSlot): number[] => {
  const incomingKeys = sourceKeys(incoming);
  if (!incomingKeys.size) return [];

  return slots.flatMap((existing, slotIndex) => {
    if (slotIndex === targetIndex || !existing || isDisplaySlot(existing)) return [];
    const existingKeys = sourceKeys(existing);
    return Array.from(incomingKeys).some((key) => existingKeys.has(key)) ? [slotIndex] : [];
  });
};

const sourceKeys = (slot: VideoSlot): Set<string> => {
  const keys = new Set<string>();
  for (const rawUrl of [slot.url, slot.playbackUrl]) {
    if (!rawUrl) continue;
    const key = canonicalSourceKey(rawUrl);
    if (key) keys.add(key);
  }
  return keys;
};

const canonicalSourceKey = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = decodeURIComponent(url.pathname)
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '') || '/';
    return `${hostname}${pathname.toLowerCase()}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
};
