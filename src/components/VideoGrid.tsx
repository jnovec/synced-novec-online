import { useControlsContext } from '@/contexts/useControls';
import { Box, Button, Flex, Grid, Image, Text } from '@chakra-ui/react';
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
      {fullscreenIndex !== null && loadedSlots.length > 0 && <Box
        position="fixed"
        left="16px"
        top="50%"
        transform="translateY(-50%)"
        w="270px"
        maxH="80vh"
        overflowY="auto"
        zIndex={1001}
        bg="rgba(18,29,42,.98)"
        borderWidth="2px"
        borderColor="whiteAlpha.400"
        borderRadius="lg"
        p="3"
        boxShadow="0 12px 32px rgba(0,0,0,.65)"
      >
        <Text color="gray.200" fontSize="sm" fontWeight="bold" mb="2">Načtená videa</Text>
        {loadedSlots.map(({ slot, index }) => slot && <Button
          key={`slot-switcher-${index}`}
          onClick={() => setFullscreenIndex(index)}
          variant="unstyled"
          w="full"
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
          {slot.thumbnailUrl ? <Image src={slot.thumbnailUrl} alt="" w="full" h="82px" objectFit="cover" /> : <Box w="full" h="82px" bg="black" />}
          <Flex alignItems="center" justifyContent="space-between" px="2" py="1">
            <Text noOfLines={1} color="blue.200" fontSize="sm" fontWeight="bold">{slot.name}</Text>
            <Text color="gray.300" fontSize="xs">Slot {index + 1}</Text>
          </Flex>
        </Button>)}
      </Box>}
    </>
  );
};
