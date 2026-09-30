import { useControlsContext } from '@/contexts/useControls';
import { useChannelsContext } from '@/contexts/useChannels';
import { Box, Button, Flex, Grid, Image, Link, Text, IconButton, useToast } from '@chakra-ui/react';
import { RepeatIcon } from '@chakra-ui/icons';
import { useEffect, useRef, useState, MouseEvent } from 'react';
import ReactPlayer from 'react-player';
import { usePagePip } from '@/hooks/usePagePip';
import { planRandomSlotFill } from '@/lib/randomSlotFill';
import { getOccupiedGridSlotIndexes } from '@/lib/clearGridSlots';
import type { VideoSlot } from '@/lib/displayMedia';
import { VideoDisplay } from './VideoGrid/VideoDisplay';

const SLOT_LAYOUT_RELOAD_EVENT = 'synced:slot-layout-reload';
const ARM_PREVIEW_PLACEMENT_EVENT = 'synced:arm-preview-placement';
interface ArmedPreviewPlacement {
  video: VideoSlot;
  thumbnailUrl?: string;
  x: number;
  y: number;
}

export const VideoGrid = () => {
  const { slots, gridSize, gridSizeMap, setSlotVideo, clearSlot, audioSettings, setSlotMuted, setSlotVolume } = useControlsContext();
  const { channels } = useChannelsContext();
  const toast = useToast();
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [stripVertical, setStripVertical] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<number, string>>({});
  const [unavailableSlots, setUnavailableSlots] = useState<number[]>([]);
  const [armedPreview, setArmedPreview] = useState<ArmedPreviewPlacement | null>(null);
  const [hoveredDropSlot, setHoveredDropSlot] = useState<number | null>(null);
  const [isPreviewFalling, setIsPreviewFalling] = useState(false);
  const dropTimerRef = useRef<number | null>(null);
  const fullscreenAudioSnapshotRef = useRef<typeof audioSettings | null>(null);
  const previousFullscreenIndexRef = useRef<number | null>(null);
  const audioSettingsRef = useRef(audioSettings);
  const audioActionsRef = useRef({ setSlotMuted, setSlotVolume });
  audioSettingsRef.current = audioSettings;
  audioActionsRef.current = { setSlotMuted, setSlotVolume };
  const stripRef = useRef<HTMLDivElement>(null);
  const pagePip = usePagePip();
  const effectiveGridSize = gridSizeMap[gridSize] && gridSize <= slots.length ? gridSize : 9;
  const layout = gridSizeMap[effectiveGridSize];
  const visibleSlotCount = effectiveGridSize;
  const loadedSlots = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => Boolean(slot) && !unavailableSlots.includes(index));
  const channelByUrl = new Map(Object.values(channels).flat().map((channel) => [channel.url, channel]));

  useEffect(() => {
    const previousIndex = previousFullscreenIndexRef.current;
    const actions = audioActionsRef.current;
    if (fullscreenIndex === null) {
      const snapshot = fullscreenAudioSnapshotRef.current;
      if (previousIndex !== null && snapshot) {
        snapshot.forEach((settings, index) => {
          actions.setSlotMuted(index, settings.muted);
          actions.setSlotVolume(index, settings.volume);
        });
        fullscreenAudioSnapshotRef.current = null;
      }
      previousFullscreenIndexRef.current = null;
      return;
    }

    if (previousIndex === null) {
      fullscreenAudioSnapshotRef.current = audioSettingsRef.current.map((settings) => ({ ...settings }));
    }
    audioSettingsRef.current.forEach((_, index) => {
      actions.setSlotMuted(index, index !== fullscreenIndex);
    });
    actions.setSlotVolume(fullscreenIndex, 0.25);
    previousFullscreenIndexRef.current = fullscreenIndex;
  }, [fullscreenIndex]);

  useEffect(() => {
    if (fullscreenIndex === null) return;

    const handleFullscreenArrowKeys = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const indexes = loadedSlots.map(({ index }) => index);
      if (indexes.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const position = indexes.indexOf(fullscreenIndex);
      if (position < 0) return;
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      setFullscreenIndex(indexes[(position + direction + indexes.length) % indexes.length]);
    };

    window.addEventListener('keydown', handleFullscreenArrowKeys, true);
    return () => window.removeEventListener('keydown', handleFullscreenArrowKeys, true);
  }, [fullscreenIndex, loadedSlots]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('synced-fullscreen-change', { detail: { active: fullscreenIndex !== null } }));
    if (fullscreenIndex !== null) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-synced-strip-slot="${fullscreenIndex}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      });
    }
  }, [fullscreenIndex]);

  useEffect(() => {
    const revealActiveSlot = () => {
      if (fullscreenIndex === null) return;
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-synced-strip-slot="${fullscreenIndex}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      });
    };
    window.addEventListener(SLOT_LAYOUT_RELOAD_EVENT, revealActiveSlot);
    return () => window.removeEventListener(SLOT_LAYOUT_RELOAD_EVENT, revealActiveSlot);
  }, [fullscreenIndex]);

  useEffect(() => {
    const handleAvailability = (event: Event) => {
      const detail = (event as CustomEvent<{ index?: number; available?: boolean }>).detail;
      if (!Number.isInteger(detail?.index)) return;
      setUnavailableSlots((current) => detail.available
        ? current.filter((index) => index !== detail.index)
        : current.includes(detail.index as number) ? current : [...current, detail.index as number]);
    };
    window.addEventListener('synced:slot-availability', handleAvailability);
    return () => window.removeEventListener('synced:slot-availability', handleAvailability);
  }, []);

  const openSlotFromStrip = (index: number) => {
    setFullscreenIndex(index);
    window.setTimeout(() => {
      const video = document.querySelector<HTMLVideoElement>(`[data-synced-slot-index="${index}"] video`);
      const playing = Boolean(video && video.readyState >= 2 && video.videoWidth && !video.paused);
      if (!playing) {
        setUnavailableSlots((current) => current.includes(index) ? current : [...current, index]);
      }
    }, 8000);
  };

  useEffect(() => {
    const handleArmPreview = (event: Event) => {
      const detail = (event as CustomEvent<ArmedPreviewPlacement>).detail;
      if (!detail?.video?.url || !detail.video.name) return;
      if (dropTimerRef.current !== null) window.clearTimeout(dropTimerRef.current);
      setArmedPreview(detail);
      setHoveredDropSlot(null);
      setIsPreviewFalling(false);
    };
    const handlePointerMove = (event: PointerEvent) => {
      setArmedPreview((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-synced-slot-index]');
      const index = target ? Number(target.dataset.syncedSlotIndex) : null;
      setHoveredDropSlot(Number.isInteger(index) ? index : null);
    };
    const handleCancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dropTimerRef.current !== null) window.clearTimeout(dropTimerRef.current);
      dropTimerRef.current = null;
      setArmedPreview(null);
      setHoveredDropSlot(null);
      setIsPreviewFalling(false);
    };
    window.addEventListener(ARM_PREVIEW_PLACEMENT_EVENT, handleArmPreview);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('keydown', handleCancel);
    return () => {
      window.removeEventListener(ARM_PREVIEW_PLACEMENT_EVENT, handleArmPreview);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('keydown', handleCancel);
      if (dropTimerRef.current !== null) window.clearTimeout(dropTimerRef.current);
    };
  }, []);

  const handleGridClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!armedPreview || isPreviewFalling) return;
    const slotElement = (event.target as HTMLElement).closest<HTMLElement>('[data-synced-slot-index]');
    if (!slotElement || !event.currentTarget.contains(slotElement)) return;
    const targetIndex = Number(slotElement.dataset.syncedSlotIndex);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= visibleSlotCount) return;

    event.preventDefault();
    event.stopPropagation();
    setHoveredDropSlot(targetIndex);
    setIsPreviewFalling(true);
    dropTimerRef.current = window.setTimeout(() => {
      setSlotVideo(targetIndex, {
        ...armedPreview.video,
        ...(armedPreview.thumbnailUrl ? { thumbnailUrl: armedPreview.thumbnailUrl } : {}),
      });
      setArmedPreview(null);
      setHoveredDropSlot(null);
      setIsPreviewFalling(false);
      dropTimerRef.current = null;
    }, 260);
  };

  useEffect(() => {
    const timers: number[] = [];
    const captureFive = (index: number) => {
      for (let shot = 0; shot < 5; shot += 1) {
        timers.push(window.setTimeout(() => {
          const video = document.querySelector<HTMLVideoElement>(`[data-synced-slot-index="${index}"] video`);
          if (!video || video.readyState < 2 || !video.videoWidth) return;
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
            setSnapshots((current) => ({ ...current, [index]: canvas.toDataURL('image/jpeg', 0.78) }));
          } catch { /* Stream may disallow canvas capture. */ }
        }, shot * 450));
      }
    };
    const handlePlaying = (event: Event) => {
      const index = (event as CustomEvent<{ index?: number }>).detail?.index;
      if (Number.isInteger(index)) captureFive(index as number);
    };
    const handleLayoutReload = () => {
      setSnapshots({});
      setUnavailableSlots([]);
      const indexes = Array.from(document.querySelectorAll<HTMLElement>('[data-synced-slot-index]'))
        .map((element) => Number(element.dataset.syncedSlotIndex))
        .filter((index) => Number.isInteger(index));
      window.setTimeout(() => indexes.forEach(captureFive), 900);
      window.setTimeout(() => indexes.forEach(captureFive), 1800);
    };
    window.addEventListener('synced:slot-playing', handlePlaying);
    window.addEventListener(SLOT_LAYOUT_RELOAD_EVENT, handleLayoutReload);
    return () => {
      window.removeEventListener('synced:slot-playing', handlePlaying);
      window.removeEventListener(SLOT_LAYOUT_RELOAD_EVENT, handleLayoutReload);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const randomizeEmptySlots = () => {
    const candidates = Object.values(channels).flat().map(({ name, url, logo, playbackUrl }) => ({
      name,
      url,
      thumbnailUrl: logo,
      playbackUrl,
    }));
    const assignments = planRandomSlotFill(slots, candidates, visibleSlotCount);
    if (!assignments.length) {
      toast({
        title: 'Není co náhodně načíst',
        description: candidates.length ? 'Všechny viditelné sloty už jsou obsazené.' : 'Nejdřív načti videa ze zdroje.',
        status: 'info',
        duration: 2600,
      });
      return;
    }
    assignments.forEach(({ index, video }) => setSlotVideo(index, video));
    toast({
      title: `Náhodně načteno ${assignments.length} videí`,
      status: 'success',
      duration: 1800,
    });
  };

  const clearAllGridSlots = () => {
    const occupiedIndexes = getOccupiedGridSlotIndexes(slots);
    if (!occupiedIndexes.length) {
      toast({ title: 'Mřížka je už prázdná', status: 'info', duration: 1800 });
      return;
    }
    occupiedIndexes.forEach(clearSlot);
    setFullscreenIndex(null);
    setSnapshots({});
    setUnavailableSlots([]);
    toast({ title: `Uvolněno ${occupiedIndexes.length} oken`, status: 'success', duration: 1800 });
  };

  return (
    <>
      <Box position="relative" w="full" h="full" minH={0}>
        <Flex position="absolute" top="3" right="3" zIndex={20} gap="2">
          <Button
            size="sm"
            colorScheme="purple"
            onClick={randomizeEmptySlots}
            aria-label="Načíst náhodná videa do prázdných slotů"
          >
            Načíst náhodně
          </Button>
          <Button
            size="sm"
            colorScheme="red"
            variant="solid"
            onClick={clearAllGridSlots}
            aria-label="Uvolnit všechna okna mřížky"
          >
            Uvolnit vše
          </Button>
        </Flex>
      <Grid
        data-synced-video-grid="true"
        templateRows={`repeat(${layout.rows}, minmax(0, 1fr))`}
        templateColumns={`repeat(${layout.columns}, minmax(0, 1fr))`}
        w="full"
        h="full"
        minH={0}
        gap="2"
        onClickCapture={handleGridClickCapture}
      >
        {Array.from({ length: visibleSlotCount }).map((_, i) => {
          const placement = layout.elements[i];
          return (
            <VideoDisplay
              key={i}
              index={i}
              onOpenFullscreen={(index) => setFullscreenIndex(index)}
              isFullscreenActive={fullscreenIndex === i}
              gridRowStart={placement.rowStart}
              gridRowEnd={placement.rowEnd}
              gridColumnStart={placement.colStart}
              gridColumnEnd={placement.colEnd}
              isClickDropTarget={armedPreview !== null && hoveredDropSlot === i}
            />
          );
        })}
      </Grid>
      {armedPreview && (
        <Box
          aria-hidden="true"
          position="fixed"
          left={`${armedPreview.x}px`}
          top={`${armedPreview.y}px`}
          w="176px"
          h="112px"
          zIndex={3000}
          pointerEvents="none"
          overflow="hidden"
          border="2px solid"
          borderColor="cyan.200"
          borderRadius="lg"
          bg="#080b10"
          boxShadow="0 0 0 3px rgba(34,211,238,.2), 0 12px 35px rgba(0,0,0,.65)"
          transform={isPreviewFalling ? 'translate(-50%, -30%) rotate(12deg) scale(.18)' : 'translate(-50%, -50%) rotate(-3deg) scale(1)'}
          opacity={isPreviewFalling ? 0 : 0.92}
          transition="transform 260ms cubic-bezier(.2,.8,.3,1), opacity 260ms ease"
        >
          {armedPreview.thumbnailUrl ? <Image src={armedPreview.thumbnailUrl} alt="" w="full" h="full" objectFit="cover" /> : <Flex w="full" h="full" align="center" justify="center" bg="gray.900"><Text color="cyan.100" fontSize="xs">LIVE PREVIEW</Text></Flex>}
          <Text position="absolute" left="0" right="0" bottom="0" px="2" py="1" color="white" fontSize="xs" fontWeight="bold" noOfLines={1} bg="blackAlpha.800">
            {isPreviewFalling ? 'Pouštím do okna…' : `${armedPreview.video.name} · klikni do gridu`}
          </Text>
        </Box>
      )}
      </Box>
      {fullscreenIndex !== null && loadedSlots.length > 0 && <Box
        position="fixed"
        {...(stripVertical
          ? { left: '16px', top: '50%', transform: 'translateY(-50%)' }
          : { left: '50%', bottom: '16px', transform: 'translateX(-50%)' })}
        maxW="min(90vw, 1100px)"
        maxH={stripVertical ? '80vh' : undefined}
        h={stripVertical ? '80vh' : undefined}
        overflow="hidden"
        zIndex={1001}
        bg="rgba(18,29,42,.98)"
        borderWidth="2px"
        borderColor="whiteAlpha.400"
        borderRadius="lg"
        p="2"
        boxShadow="0 12px 32px rgba(0,0,0,.65)"
      >
        <Flex alignItems="center" gap="2" flexDirection={stripVertical ? 'column' : 'row'}>
        <Button
          size="xs"
          variant="ghost"
          color="gray.300"
          zIndex={2}
          flexShrink={0}
          bg="gray.600"
          onMouseEnter={() => setStripVertical((vertical) => !vertical)}
          aria-label="Přepnout orientaci panelu"
        >
          {stripVertical ? '↔' : '↕'}
        </Button>
        <IconButton
          aria-label="Obnovit rozložení slotů"
          icon={<RepeatIcon />}
          size="xs"
          colorScheme="gray"
          flexShrink={0}
          onMouseEnter={() => window.dispatchEvent(new CustomEvent(SLOT_LAYOUT_RELOAD_EVENT))}
        />
        <Box
          ref={stripRef}
          overflow={stripVertical ? 'auto' : 'hidden'}
          sx={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            scrollbarColor: 'transparent transparent',
            WebkitOverflowScrolling: 'touch',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
          overscrollBehaviorX="contain"
          maxW={stripVertical ? undefined : 'calc(90vw - 64px)'}
          maxH={stripVertical ? 'calc(80vh - 16px)' : undefined}
          onWheelCapture={(event) => {
            if (stripVertical || !stripRef.current) return;
            event.preventDefault();
            const distance = Math.abs(event.deltaX) > 0.5 ? event.deltaX : event.deltaY;
            stripRef.current.scrollLeft += distance;
          }}
        >
        <Flex alignItems="center" gap="2" minW={stripVertical ? undefined : 'max-content'} flexDirection={stripVertical ? 'column' : 'row'}>
        {loadedSlots.map(({ slot, index }) => slot && <Button
          key={`slot-switcher-${index}`}
          data-synced-strip-slot={index}
          onClick={() => openSlotFromStrip(index)}
          variant="unstyled"
          w="180px"
          flexShrink={0}
          display="block"
          whiteSpace="normal"
          mb="1"
          h="auto"
          minH="116px"
          p="0"
          overflow="hidden"
          borderWidth="2px"
          borderColor={fullscreenIndex === index ? 'red.300' : 'whiteAlpha.300'}
          borderRadius="md"
          bg="blueGray.900"
          _hover={{ borderColor: 'red.200', transform: 'scale(1.02)' }}
          transition="transform 120ms ease, border-color 120ms ease"
        >
          {snapshots[index] ? <Image src={snapshots[index]} alt="" w="full" h="82px" objectFit="cover" /> : (slot.thumbnailUrl || channelByUrl.get(slot.url)?.logo) ? <Image src={slot.thumbnailUrl || channelByUrl.get(slot.url)?.logo} alt="" w="full" h="82px" objectFit="cover" /> : slot.playbackUrl ? <ReactPlayer url={slot.playbackUrl} playing muted loop playsinline width="100%" height="82px" config={{ file: { forceHLS: true } }} style={{ objectFit: 'cover', pointerEvents: 'none' }} /> : <Box w="full" h="82px" bg="black" />}
          <Flex alignItems="center" justifyContent="space-between" px="2" py="1">
            <Link
              as="button"
              type="button"
              noOfLines={1}
              color="blue.200"
              fontSize="sm"
              fontWeight="bold"
              textAlign="left"
              minW={0}
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              onClick={(event) => {
                event.stopPropagation();
                void pagePip.open(slot.url, slot.name);
              }}
              _hover={{ color: 'blue.100', textDecoration: 'underline' }}
            >{slot.name}</Link>
            <Text color="gray.300" fontSize="xs">Slot {index + 1}</Text>
          </Flex>
        </Button>)}
        </Flex>
        </Box>
        </Flex>
      </Box>}
    </>
  );
};
