import { useControlsContext, VideoSlot } from '@/contexts/useControls';
import { applyMediaAudio } from '@/lib/audioControls';
import { isDisplaySlot } from '@/lib/displayMedia';
import { resolveRemoteStreamUrl, shouldEmbedRemotePage } from '@/lib/remoteVideo';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, RepeatIcon } from '@chakra-ui/icons';
import {
  Box,
  Button,
  Flex,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Text,
} from '@chakra-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import { DisplayMediaPlayer } from './DisplayMediaPlayer';

interface FullscreenVideoViewerProps {
  isOpen: boolean;
  initialIndex: number | null;
  slots: (VideoSlot | null)[];
  onClose: () => void;
}

const GAMEPAD_LEFT_BUTTON = 14;
const GAMEPAD_RIGHT_BUTTON = 15;
const GAMEPAD_STICK_DEADZONE = 0.55;
const GAMEPAD_REPEAT_MS = 260;
const STREAM_RESOLVE_ATTEMPTS = 3;

const waitForRetry = (attempt: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, 700 * attempt);
});

const FULLSCREEN_EXPAND_MS = 480;

export const FullscreenVideoViewer = ({ isOpen, initialIndex, slots, onClose }: FullscreenVideoViewerProps) => {
  const { audioSettings, displayStreams, setSlotMuted, setSlotVolume } = useControlsContext();
  const [currentIndex, setCurrentIndex] = useState<number | null>(initialIndex);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const mediaRootRef = useRef<HTMLDivElement>(null);
  const gamepadStateRef = useRef({ left: false, right: false });
  const gamepadLastMoveRef = useRef(0);
  const goRef = useRef<(direction: -1 | 1) => void>(() => undefined);
  const playbackFailuresRef = useRef(0);

  const occupiedIndexes = useMemo(() => slots.flatMap((slot, index) => (slot ? [index] : [])), [slots]);
  const currentSlot = currentIndex === null ? null : slots[currentIndex];
  const isDisplay = isDisplaySlot(currentSlot);
  const currentDisplayStream = currentIndex === null ? null : displayStreams[currentIndex];
  const audio = currentIndex === null ? null : audioSettings[currentIndex];

  useEffect(() => {
    if (isOpen) setCurrentIndex(initialIndex);
  }, [initialIndex, isOpen]);

  const go = (direction: -1 | 1) => {
    if (currentIndex === null || occupiedIndexes.length < 2) return;
    const position = occupiedIndexes.indexOf(currentIndex);
    const nextPosition = (position + direction + occupiedIndexes.length) % occupiedIndexes.length;
    setCurrentIndex(occupiedIndexes[nextPosition]);
  };

  goRef.current = go;

  const refreshCurrentStream = () => {
    playbackFailuresRef.current = 0;
    setReloadKey((current) => current + 1);
  };

  const handlePlayerError = () => {
    if (playbackFailuresRef.current < 2) {
      playbackFailuresRef.current += 1;
      setReloadKey((current) => current + 1);
      return;
    }

    setResolvedUrl(null);
    setStreamError('Přehrávání se přerušilo. Obnov stream a zkus to znovu.');
  };

  useEffect(() => {
    playbackFailuresRef.current = 0;
    setMediaReady(false);
  }, [currentSlot?.playbackUrl, currentSlot?.url]);

  useEffect(() => {
    if (!isOpen) return;

    gamepadStateRef.current = { left: false, right: false };
    gamepadLastMoveRef.current = 0;

    let cancelled = false;
    let frameId: number | null = null;

    const pollGamepad = () => {
      if (cancelled) return;

      const gamepad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
      if (gamepad) {
        const left = Boolean(gamepad.buttons[GAMEPAD_LEFT_BUTTON]?.pressed)
          || (gamepad.axes[0] ?? 0) < -GAMEPAD_STICK_DEADZONE;
        const right = Boolean(gamepad.buttons[GAMEPAD_RIGHT_BUTTON]?.pressed)
          || (gamepad.axes[0] ?? 0) > GAMEPAD_STICK_DEADZONE;
        const previous = gamepadStateRef.current;
        const now = performance.now();

        if ((left && !previous.left) || (right && !previous.right)) {
          goRef.current(left ? -1 : 1);
          gamepadLastMoveRef.current = now;
        } else if ((left || right) && now - gamepadLastMoveRef.current >= GAMEPAD_REPEAT_MS) {
          goRef.current(left ? -1 : 1);
          gamepadLastMoveRef.current = now;
        }

        gamepadStateRef.current = { left, right };
      } else {
        gamepadStateRef.current = { left: false, right: false };
      }

      frameId = window.requestAnimationFrame(pollGamepad);
    };

    frameId = window.requestAnimationFrame(pollGamepad);
    return () => {
      cancelled = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goRef.current(-1);
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goRef.current(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!isOpen || !currentSlot?.url || isDisplay) {
      setResolvedUrl(null);
      setLoading(false);
      setStreamError(null);
      return;
    }

    setLoading(true);
    setMediaReady(false);
    setResolvedUrl(null);
    setStreamError(null);

    const resolveStream = async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, FULLSCREEN_EXPAND_MS));
      if (cancelled) return;
      for (let attempt = 1; attempt <= STREAM_RESOLVE_ATTEMPTS; attempt += 1) {
        try {
          const streamUrl = await resolveRemoteStreamUrl(currentSlot.url, currentSlot.playbackUrl);
          if (cancelled) return;
          if (streamUrl || shouldEmbedRemotePage(currentSlot.url)) {
            setResolvedUrl(streamUrl);
            setLoading(false);
            return;
          }
        } catch {
          // The live provider may rotate a stream URL while the player is opening.
        }

        if (attempt < STREAM_RESOLVE_ATTEMPTS) await waitForRetry(attempt);
      }

      if (!cancelled) {
        setLoading(false);
        setStreamError('Stream se nepodařilo načíst. Zkus ho obnovit.');
      }
    };

    void resolveStream();

    return () => {
      cancelled = true;
    };
  }, [currentSlot?.playbackUrl, currentSlot?.url, isDisplay, isOpen, reloadKey]);

  const hasNavigation = occupiedIndexes.length > 1;

  const handleToggleAudio = () => {
    if (currentIndex === null || !audio) return;
    const nextMuted = !audio.muted;
    const media = mediaRootRef.current?.querySelector('video');
    if (media) void applyMediaAudio(media, { muted: nextMuted, volume: audio.volume }).catch(() => undefined);
    setSlotMuted(currentIndex, nextMuted);
  };

  const handleVolumeChange = (value: number) => {
    if (currentIndex === null) return;
    const volume = value / 100;
    const media = mediaRootRef.current?.querySelector('video');
    if (media) media.volume = volume;
    setSlotVolume(currentIndex, volume);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="full" motionPreset="slideInBottom" preserveScrollBarGap>
      <ModalContent
        bg="#030303"
        m="0"
        borderRadius="0"
        overflow="hidden"
        border="2px solid"
        borderColor="purple.400"
        boxShadow="0 0 0 1px rgba(168,85,247,.9), 0 0 24px rgba(168,85,247,.95), inset 0 0 30px rgba(34,211,238,.18)"
        sx={{
          animation: `synced-fullscreen-expand ${FULLSCREEN_EXPAND_MS}ms cubic-bezier(.2,.8,.2,1) both`,
          '@keyframes synced-fullscreen-expand': {
            from: {
              opacity: 0.72,
              transform: 'scale(0.72)',
              borderColor: '#22d3ee',
              boxShadow: '0 0 0 2px rgba(34,211,238,.95), 0 0 48px rgba(34,211,238,.95), inset 0 0 40px rgba(168,85,247,.38)',
            },
            to: {
              opacity: 1,
              transform: 'scale(1)',
              borderColor: '#a855f7',
              boxShadow: '0 0 0 1px rgba(168,85,247,.9), 0 0 24px rgba(168,85,247,.95), inset 0 0 30px rgba(34,211,238,.18)',
            },
          },
        }}
      >
        <ModalBody
          ref={mediaRootRef}
          p="0"
          position="relative"
          display="flex"
          alignItems="center"
          justifyContent="center"
          data-synced-fullscreen-viewer="true"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('button, input, [role="slider"]')) return;
            onClose();
          }}
        >
          {isDisplay && currentDisplayStream && audio ? (
            <Box position="absolute" inset={0}>
              <DisplayMediaPlayer stream={currentDisplayStream} muted={audio.muted} volume={audio.volume} />
            </Box>
          ) : loading ? (
            <Box position="absolute" inset={0} bg="black" backgroundImage={currentSlot?.thumbnailUrl ? `url(${currentSlot.thumbnailUrl})` : undefined} backgroundSize="cover" backgroundPosition="center" />
          ) : resolvedUrl ? (
            <Box position="absolute" inset={0} bg="black" backgroundImage={currentSlot?.thumbnailUrl ? `url(${currentSlot.thumbnailUrl})` : undefined} backgroundSize="cover" backgroundPosition="center">
              <ReactPlayer
                width="100%"
                height="100%"
                url={resolvedUrl}
                playing
                muted={audio?.muted ?? true}
                volume={audio?.volume ?? 0.5}
                config={{
                  file: {
                    forceHLS: true,
                    attributes: { crossOrigin: 'true' },
                    hlsOptions: {
                      lowLatencyMode: false,
                      liveSyncDurationCount: 3,
                      liveMaxLatencyDurationCount: 10,
                      capLevelToPlayerSize: false,
                      abrEwmaDefaultEstimate: 8_000_000,
                      maxBufferLength: 30,
                      maxMaxBufferLength: 90,
                    },
                  },
                }}
                style={{
                  opacity: mediaReady ? 1 : 0,
                  transition: 'opacity 480ms ease-in-out',
                }}
                onReady={() => setMediaReady(true)}
                onError={handlePlayerError}
              />
            </Box>
          ) : currentSlot && shouldEmbedRemotePage(currentSlot.url) ? (
            <Box
              as="iframe"
              title={currentSlot.name}
              src={currentSlot.url}
              position="absolute"
              inset={0}
              w="100%"
              h="100%"
              border="0"
              sandbox="allow-scripts allow-forms allow-popups allow-presentation"
              referrerPolicy="no-referrer"
            />
          ) : streamError ? (
            <Flex direction="column" alignItems="center" gap="3" color="gray.300" px="5" textAlign="center">
              <Text>{streamError}</Text>
              <Button leftIcon={<RepeatIcon />} onClick={refreshCurrentStream}>
                Obnovit stream
              </Button>
            </Flex>
          ) : (
            <Text color="gray.400">Stream není dostupný.</Text>
          )}

          <Flex position="absolute" top="5" left="5" right="5" justifyContent="space-between" alignItems="center" pointerEvents="none">
            <Box bg="blackAlpha.700" px="3" py="2" borderRadius="md" pointerEvents="auto">
              <Text color="white" fontWeight="bold">{currentSlot?.name ?? 'Stream'}</Text>
              <Text color="gray.300" fontSize="sm">slot {(currentIndex ?? 0) + 1} · {occupiedIndexes.length} aktivních streamů</Text>
            </Box>
            <Flex gap="2" pointerEvents="auto">
              <IconButton
                aria-label="Obnovit stream ve fullscreenu"
                icon={<RepeatIcon />}
                onClick={refreshCurrentStream}
                isDisabled={isDisplay || !currentSlot || loading}
              />
              <IconButton aria-label="Zavřít celoobrazovkový přehrávač" icon={<CloseIcon />} onClick={onClose} colorScheme="red" />
            </Flex>
          </Flex>

          {hasNavigation && (
            <>
              <IconButton
                aria-label="Předchozí stream"
                icon={<ChevronLeftIcon boxSize="9" />}
                onClick={() => go(-1)}
                position="absolute"
                left="5"
                top="50%"
                transform="translateY(-50%)"
                size="lg"
                borderRadius="full"
                bg="blackAlpha.700"
                color="white"
                _hover={{ bg: 'red.600' }}
              />
              <IconButton
                aria-label="Další stream"
                icon={<ChevronRightIcon boxSize="9" />}
                onClick={() => go(1)}
                position="absolute"
                right="5"
                top="50%"
                transform="translateY(-50%)"
                size="lg"
                borderRadius="full"
                bg="blackAlpha.700"
                color="white"
                _hover={{ bg: 'red.600' }}
              />
            </>
          )}

          {currentIndex !== null && audio && (
            <Flex
              position="absolute"
              bottom="6"
              left="50%"
              transform="translateX(-50%)"
              alignItems="center"
              gap="3"
              bg="blackAlpha.800"
              px="4"
              py="3"
              borderRadius="full"
              minW="280px"
            >
              <Button
                size="sm"
                minW="64px"
                colorScheme={audio.muted ? 'gray' : 'green'}
                onClick={handleToggleAudio}
                aria-label={audio.muted ? 'Zapnout zvuk' : 'Ztlumit zvuk'}
              >
                {audio.muted ? 'Zapnout zvuk' : 'Mute'}
              </Button>
              <Slider
                aria-label="Hlasitost"
                value={audio.volume * 100}
                onChange={handleVolumeChange}
                min={0}
                max={100}
                step={1}
                focusThumbOnChange={false}
              >
                <SliderTrack bg="whiteAlpha.400">
                  <SliderFilledTrack bg={audio.muted ? 'gray.400' : 'green.300'} />
                </SliderTrack>
                <SliderThumb />
              </Slider>
              <Text color="white" fontSize="sm" minW="38px" textAlign="right">
                {Math.round(audio.volume * 100)} %
              </Text>
            </Flex>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
