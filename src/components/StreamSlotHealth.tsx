import { useControlsContext } from '@/contexts/useControls';
import { useEffect } from 'react';

/**
 * Watches native video elements rendered by the grid. When a remote stream
 * ends or fails, release its grid slot so it can be reused immediately.
 */
export const StreamSlotHealth = () => {
  const { clearSlot } = useControlsContext();

  useEffect(() => {
    const getSlotIndex = (video: HTMLVideoElement) => {
      const grid = video.closest('[data-synced-video-grid]');
      if (!grid) return null;
      const slotElement = video.closest('[data-synced-slot-index]');
      if (!slotElement) return null;
      const value = slotElement.getAttribute('data-synced-slot-index');
      const index = value === null ? NaN : Number(value);
      return Number.isInteger(index) ? index : null;
    };

    const handleMediaFailure = (event: Event) => {
      const video = event.currentTarget as HTMLVideoElement;
      const index = getSlotIndex(video);
      if (index === null) return;
      clearSlot(index);
    };

    const bindVideos = () => {
      document.querySelectorAll<HTMLVideoElement>('[data-synced-slot-index] video').forEach((video) => {
        if (video.dataset.syncedHealthBound === '1') return;
        video.dataset.syncedHealthBound = '1';
        video.addEventListener('ended', handleMediaFailure);
        video.addEventListener('error', handleMediaFailure);
      });
    };

    bindVideos();
    const observer = new MutationObserver(bindVideos);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLVideoElement>('[data-synced-slot-index] video').forEach((video) => {
        video.removeEventListener('ended', handleMediaFailure);
        video.removeEventListener('error', handleMediaFailure);
        delete video.dataset.syncedHealthBound;
      });
    };
  }, [clearSlot]);

  return null;
};
