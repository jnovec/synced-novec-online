import { useControlsContext } from '@/contexts/useControls';
import { Box, Button, Grid, Image, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { VideoDisplay } from './VideoGrid/VideoDisplay';

export const VideoGrid = () => {
  const { slots, gridSize, gridSizeMap } = useControlsContext();
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const effectiveGridSize = gridSizeMap[gridSize] && gridSize <= slots.length ? gridSize : 9;
  const layout = gridSizeMap[effectiveGridSize];
  const visibleSlotCount = effectiveGridSize;
  const loadedSlots = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => Boolean(slot));

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('synced-fullscreen-change', { detail: { active: fullscreenIndex !== null } }));
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
      {loadedSlots.length > 0 && <Box
        position="fixed"
        right="16px"
        bottom="16px"
        w="220px"
        maxH="min(60vh, 520px)"
        overflowY="auto"
        zIndex={1001}
        bg="rgba(17,24,7,.96)"
        borderWidth="1px"
        borderColor="purple.300"
        borderRadius="lg"
        p="2"
        boxShadow="0 12px 32px rgba(0,0,0,.65)"
      >
        <Text color="gray.300" fontSize="xs" fontWeight="bold" mb="1">Načtené sloty</Text>
        {loadedSlots.map(({ slot, index }) => slot && <Button
          key={`slot-switcher-${index}`}
          onClick={() => setFullscreenIndex(index)}
          variant={fullscreenIndex === index ? 'solid' : 'ghost'}
          colorScheme="purple"
          w="full"
          justifyContent="flex-start"
          mb="1"
          h="42px"
          p="1"
        >
          {slot.thumbnailUrl ? <Image src={slot.thumbnailUrl} alt="" w="54px" h="32px" objectFit="cover" borderRadius="sm" mr="2" /> : <Box w="54px" h="32px" bg="black" borderRadius="sm" mr="2" />}
          <Text noOfLines={1} fontSize="xs">Slot {index + 1} · {slot.name}</Text>
        </Button>)}
      </Box>}
    </>
  );
};
