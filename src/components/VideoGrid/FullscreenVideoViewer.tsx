import { useControlsContext, VideoSlot } from '@/contexts/useControls';
import { applyMediaAudio } from '@/lib/audioControls';
import { isDisplaySlot } from '@/lib/displayMedia';
import { resolveRemoteStreamUrl, shouldEmbedRemotePage } from '@/lib/remoteVideo';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '@chakra-ui/icons';
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
  Spinner,
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

export const FullscreenVideoViewer = ({ isOpen, initialIndex, slots, onClose }: FullscreenVideoViewerProps) => {
  const { audioSettings, displayStreams, setSlotMuted, setSlotVolume } = useControlsContext();
  const [currentIndex, setCurrentIndex] = useState<number | null>(initialIndex);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mediaRootRef = useRef<HTMLDivElement>(null);

  const occupiedIndexes = useMemo(() => slots.flatMap((slot, index) => (slot ? [index] : [])), [slots]);
  const currentSlot = currentIndex === null ? null : slots[currentIndex];
  const isDisplay = isDisplaySlot(currentSlot);
  const currentDisplayStream = currentIndex === null ? null : displayStreams[currentIndex];
  const audio = currentIndex === null ? null : audioSettings[currentIndex];

  useEffect(() => {
    if (isOpen) setCurrentIndex(initialIndex);
  }, [initialIndex, isOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!isOpen || !currentSlot?.url || isDisplay) {
      setResolvedUrl(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setResolvedUrl(null);
    resolveRemoteStreamUrl(currentSlot.url, currentSlot.playbackUrl)
      .then((streamUrl) => {
        if (!cancelled) setResolvedUrl(streamUrl);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentSlot?.playbackUrl, currentSlot?.url, isDisplay, isOpen]);

  const go = (direction: -1 | 1) => {
    if (currentIndex === null || occupiedIndexes.length < 2) return;
    const position = occupiedIndexes.indexOf(currentIndex);
    const nextPosition = (position + direction + occupiedIndexes.length) % occupiedIndexes.length;
    setCurrentIndex(occupiedIndexes[nextPosition]);
  };

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
      <ModalContent bg="#030303" m="0" borderRadius="0" overflow="hidden">
        <ModalBody ref={mediaRootRef} p="0" position="relative" display="flex" alignItems="center" justifyContent="center">
          {isDisplay && currentDisplayStream && audio ? (
            <Box position="absolute" inset={0}>
              <DisplayMediaPlayer stream={currentDisplayStream} muted={audio.muted} volume={audio.volume} />
            </Box>
          ) : loading ? (
            <Flex direction="column" alignItems="center" gap="3" color="gray.300">
              <Spinner size="lg" />
              <Text>Načítám {currentSlot?.name}…</Text>
            </Flex>
          ) : resolvedUrl ? (
            <Box position="absolute" inset={0}>
              <ReactPlayer
                width="100%"
                height="100%"
                url={resolvedUrl}
                playing
                muted={audio?.muted ?? true}
                volume={audio?.volume ?? 0.5}
                config={{ file: { forceHLS: true, attributes: { crossOrigin: 'true' } } }}
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
          ) : (
            <Text color="gray.400">Stream není dostupný.</Text>
          )}

          <Flex position="absolute" top="5" left="5" right="5" justifyContent="space-between" alignItems="center" pointerEvents="none">
            <Box bg="blackAlpha.700" px="3" py="2" borderRadius="md" pointerEvents="auto">
              <Text color="white" fontWeight="bold">{currentSlot?.name ?? 'Stream'}</Text>
              <Text color="gray.300" fontSize="sm">slot {(currentIndex ?? 0) + 1} · {occupiedIndexes.length} aktivních streamů</Text>
            </Box>
            <IconButton aria-label="Zavřít celoobrazovkový přehrávač" icon={<CloseIcon />} onClick={onClose} pointerEvents="auto" colorScheme="red" />
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
