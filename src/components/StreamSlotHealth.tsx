import { useControlsContext } from '@/contexts/useControls';
import { useEffect } from 'react';

/** Releases a grid slot when its native video ends, errors, or its stream cannot be resolved. */
export const StreamSlotHealth = () => {
  const { clearSlot } = useControlsContext();

  useEffect(() => {
    const getSlotIndex = (video: HTMLVideoElement) => {
      const grid = video.closest('[data-synced-video-grid]');
      if (!grid) return null;

      let element: Element | null = video;
      while (element && element.parentElement !== grid) {
        element = element.parentElement;
      }
      if (!element) return null;

      const index = Array.from(grid.children).indexOf(element);
      return index >= 0 ? index : null;
    };

    const getFallbackSlotIndexes = () => {
      const grid = document.querySelector<HTMLElement>('[data-synced-video-grid]');
      if (!grid) return [];

      return Array.from(grid.children)
        .map((child, index) => (child.textContent?.includes('Zdroj není dostupný.') ? index : -1))
        .filter((index) => index >= 0);
    };

    const handleMediaFailure = (event: Event) => {
      const video = event.currentTarget as HTMLVideoElement;
      const index = getSlotIndex(video);
      if (index === null) return;
      clearSlot(index);
    };

    const releaseUnresolvedSlots = () => {
      getFallbackSlotIndexes().forEach((index) => clearSlot(index));
    };

    const bindVideos = () => {
      document.querySelectorAll<HTMLVideoElement>('[data-synced-video-grid] video').forEach((video) => {
        if (video.dataset.syncedHealthBound === '1') return;
        video.dataset.syncedHealthBound = '1';
        video.addEventListener('ended', handleMediaFailure);
        video.addEventListener('error', handleMediaFailure);
      });

      releaseUnresolvedSlots();
    };

    bindVideos();
    const observer = new MutationObserver(bindVideos);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLVideoElement>('[data-synced-video-grid] video').forEach((video) => {
        video.removeEventListener('ended', handleMediaFailure);
        video.removeEventListener('error', handleMediaFailure);
        delete video.dataset.syncedHealthBound;
      });
    };
  }, [clearSlot]);

  return null;
};
