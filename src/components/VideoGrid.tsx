import { useControlsContext } from '@/contexts/useControls';
import { useChannelsContext } from '@/contexts/useChannels';
import { Box, Button, Flex, Grid, Image, Text } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import { VideoDisplay } from './VideoGrid/VideoDisplay';

export const VideoGrid = () => {
  const { slots, gridSize, gridSizeMap } = useControlsContext();
  const { channels } = useChannelsContext();
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [stripVertical, setStripVertical] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<number, string>>({});
  const stripRef = useRef<HTMLDivElement>(null);
  const effectiveGridSize = gridSizeMap[gridSize] && gridSize <= slots.length ? gridSize : 9;
  const layout = gridSizeMap[effectiveGridSize];
  const visibleSlotCount = effectiveGridSize;
  const loadedSlots = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => Boolean(slot));
  const channelByUrl = new Map(Object.values(channels).flat().map((channel) => [channel.url, channel]));

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('synced-fullscreen-change', { detail: { active: fullscreenIndex !== null } }));
  }, [fullscreenIndex]);

  useEffect(() => {
    if (fullscreenIndex === null) return;
    const takeSnapshots = () => {
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('[data-synced-video-grid="true"] video'));
      const next: Record<number, string> = {};
      videos.forEach((video, index) => {
        if (video.readyState < 2 || !video.videoWidth) return;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
          next[index] = canvas.toDataURL('image/jpeg', 0.78);
        } catch { /* Stream may disallow canvas capture; use source fallback. */ }
      });
      if (Object.keys(next).length) setSnapshots((current) => ({ ...current, ...next }));
    };
    takeSnapshots();
    const timer = window.setInterval(takeSnapshots, 2500);
    return () => window.clearInterval(timer);
  }, [fullscreenIndex]);

  return (
    <>
      <Grid
        data-synced-video-grid="true"
        templateRows={`repeat(${layout.rows}, minmax(0, 1fr))`}
        templateColumns={`repeat(${layout.columns}, minmax(0, 1fr))`}
        w="full"
        h="full"
        minH={0}
        gap="2"
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
            />
          );
        })}
      </Grid>
      {fullscreenIndex !== null && loadedSlots.length > 0 && <Box
        position="fixed"
        {...(stripVertical
          ? { left: '16px', top: '50%', transform: 'translateY(-50%)' }
          : { left: '50%', bottom: '16px', transform: 'translateX(-50%)' })}
        maxW="min(90vw, 1100px)"
        maxH={stripVertical ? '80vh' : undefined}
        overflow={stripVertical ? 'auto' : 'hidden'}
        overscrollBehaviorX="contain"
        zIndex={1001}
        bg="rgba(18,29,42,.98)"
        borderWidth="2px"
        borderColor="whiteAlpha.400"
        borderRadius="lg"
        p="2"
        boxShadow="0 12px 32px rgba(0,0,0,.65)"
        ref={stripRef}
        onWheelCapture={(event) => {
          if (stripVertical || !stripRef.current) return;
          event.preventDefault();
          const distance = Math.abs(event.deltaX) > 0.5 ? event.deltaX : event.deltaY;
          stripRef.current.scrollLeft += distance;
        }}
      >
        <Flex alignItems="center" gap="2" minW={stripVertical ? undefined : 'max-content'} flexDirection={stripVertical ? 'column' : 'row'}>
        <Text color="gray.200" fontSize="sm" fontWeight="bold" px="1">▥</Text>
        <Button size="xs" variant="ghost" color="gray.300" onClick={() => setStripVertical((vertical) => !vertical)} aria-label="Přepnout orientaci panelu">{stripVertical ? '↔' : '↕'}</Button>
        {loadedSlots.map(({ slot, index }) => slot && <Button
          key={`slot-switcher-${index}`}
          onClick={() => setFullscreenIndex(index)}
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
            <Text noOfLines={1} color="blue.200" fontSize="sm" fontWeight="bold">{slot.name}</Text>
            <Text color="gray.300" fontSize="xs">Slot {index + 1}</Text>
          </Flex>
        </Button>)}
        </Flex>
      </Box>}
    </>
  );
};
