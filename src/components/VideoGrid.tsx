import { useControlsContext } from '@/contexts/useControls';
import { Grid } from '@chakra-ui/react';
import { useState } from 'react';
import { FullscreenVideoViewer } from './VideoGrid/FullscreenVideoViewer';
import { VideoDisplay } from './VideoGrid/VideoDisplay';

export const VideoGrid = () => {
  const { slots, gridSize, gridSizeMap } = useControlsContext();
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const effectiveGridSize = gridSizeMap[gridSize] && gridSize <= slots.length ? gridSize : 9;
  const layout = gridSizeMap[effectiveGridSize];
  const visibleSlotCount = effectiveGridSize;

  return (
    <>
      <Grid
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
              onOpenFullscreen={setFullscreenIndex}
              isFullscreenActive={fullscreenIndex !== null}
              gridRowStart={placement.rowStart}
              gridRowEnd={placement.rowEnd}
              gridColumnStart={placement.colStart}
              gridColumnEnd={placement.colEnd}
            />
          );
        })}
      </Grid>
      <FullscreenVideoViewer
        isOpen={fullscreenIndex !== null}
        initialIndex={fullscreenIndex}
        slots={slots}
        onClose={() => setFullscreenIndex(null)}
      />
    </>
  );
};
