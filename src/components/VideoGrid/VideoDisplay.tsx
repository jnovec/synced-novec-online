import { useControlsContext } from '@/contexts/useControls';
import { useAudioGamepadVibration } from '@/hooks/useAudioGamepadVibration';
import { applyMediaAudio } from '@/lib/audioControls';
import { isDisplaySlot } from '@/lib/displayMedia';
import type { VideoSlot } from '@/lib/displayMedia';
import { findVibrationGamepad, vibrateGamepad } from '@/lib/gamepadVibration';
import { normalizeRemoteVideo, resolveRemoteStreamUrl, shouldEmbedRemotePage } from '@/lib/remoteVideo';
import { CloseIcon } from '@chakra-ui/icons';
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

interface VideoDisplayProps {
  index: number;
  onOpenFullscreen: (index: number) => void;
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
  const audio = audioSettings[index];
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSlotDragOver, setIsSlotDragOver] = useState(false);
  const [isSlotDragging, setIsSlotDragging] = useState(false);
  const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [sharingDisplay, setSharingDisplay] = useState(false);
  const [gamepadVibrationEnabled, setGamepadVibrationEnabled] = useState(false);
  const [vibrationSensitivity, setVibrationSensitivity] = useState(2.4);
  const [isDuplicateHighlighted, setIsDuplicateHighlighted] = useState(false);
  const mediaRootRef = useRef<HTMLDivElement>(null);
  const { status: vibrationStatus, level: vibrationLevel } = useAudioGamepadVibration({
    stream: isDisplay ? displayStream : null,
    enabled: gamepadVibrationEnabled,
    sensitivity: vibrationSensitivity,
  });

  useEffect(() => {
    if (!isDisplay || !displayStream) setGamepadVibrationEnabled(false);
  }, [displayStream, isDisplay]);

  useEffect(() => {
    const handleDuplicateHighlight = (event: Event) => {
      const detail = (event as CustomEvent<{ slotIndexes?: number[] }>).detail;
      setIsDuplicateHighlighted(Boolean(detail?.slotIndexes?.includes(index)));
    };

    window.addEventListener(DUPLICATE_SOURCE_EVENT, handleDuplicateHighlight);
    return () => window.removeEventListener(DUPLICATE_SOURCE_EVENT, handleDuplicateHighlight);
  }, [index]);

  useEffect(() => {
    let cancelled = false;
    if (!slot?.url || isDisplay) {
      setResolvedUrl(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setResolvedUrl(null);

    resolveRemoteStreamUrl(slot.url, slot.playbackUrl)
      .then((streamUrl) => {
        if (cancelled) return;
        setResolvedUrl(streamUrl);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDisplay, slot?.playbackUrl, slot?.url]);

  const handleClick = () => {
    if (slot) {
      onOpenFullscreen(index);
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
    const video = normalizeRemoteVideo(url, suppliedName, playbackUrl);

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

  return (
    <>
      <GridItem
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
        borderRadius="lg"
        overflow="hidden"
        pos="relative"
        bg="black"
        opacity={isSlotDragging ? 0.55 : 1}
        boxShadow={
          isDuplicateHighlighted
            ? '0 0 0 2px rgba(229,62,62,.8), 0 0 34px rgba(229,62,62,.75)'
            : isSlotDragOver
              ? '0 0 0 2px rgba(103,232,249,.65), 0 0 30px rgba(34,211,238,.5)'
              : undefined
        }
        zIndex={isDuplicateHighlighted || isSlotDragOver ? 12 : 0}
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
          <Box ref={mediaRootRef} position="absolute" inset={0}>
            {isDisplay && displayStream ? (
              <DisplayMediaPlayer
                stream={displayStream}
                muted={isFullscreenActive || audio.muted}
                volume={audio.volume}
              />
            ) : loading ? (
              <Flex h="full" alignItems="center" justifyContent="center" direction="column" gap="2" color="gray.400">
                <Spinner size="sm" />
                <Text fontSize="xs">Načítám…</Text>
              </Flex>
            ) : resolvedUrl ? (
              <ReactPlayer
                width="100%"
                height="100%"
                url={resolvedUrl}
                playing
                muted={isFullscreenActive || audio.muted}
                volume={audio.volume}
                config={{
                  file: {
                    forceHLS: true,
                    attributes: {
                      crossOrigin: 'true',
                    },
                  },
                }}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              />
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
              <Text color="#EEEEEC" fontSize="xs" noOfLines={1} minW={0}>
                {slot.name}
              </Text>
              <Flex
                alignItems="center"
                gap="2"
                flexShrink={0}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Ovládání zvuku pro slot ${index + 1}`}
              >
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