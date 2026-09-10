import { useControlsContext } from '@/contexts/useControls';
import { useEffect, useRef } from 'react';

const LEFT_BUTTON = 14;
const RIGHT_BUTTON = 15;
const STICK_DEADZONE = 0.55;
const REPEAT_DELAY_MS = 260;

export const GamepadNavigation = () => {
  const { slots, selectedVideo, setSelectedVideo } = useControlsContext();
  const previousStateRef = useRef({ left: false, right: false });
  const lastMoveAtRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const movePreview = (direction: -1 | 1) => {
      // FullscreenVideoViewer owns horizontal navigation while it is open.
      if (document.querySelector('[data-synced-fullscreen-viewer="true"]')) return;

      const occupied = slots
        .map((slot, index) => (slot && slot.sourceType !== 'display' ? index : -1))
        .filter((index) => index >= 0);
      if (!occupied.length) return;

      const currentIndex = selectedVideo?.url
        ? occupied.findIndex((slotIndex) => slots[slotIndex]?.url === selectedVideo.url)
        : -1;
      const nextPosition = currentIndex < 0
        ? direction > 0 ? 0 : occupied.length - 1
        : (currentIndex + direction + occupied.length) % occupied.length;
      const nextSlot = slots[occupied[nextPosition]];
      if (nextSlot) setSelectedVideo(nextSlot);
      lastMoveAtRef.current = performance.now();
    };

    const poll = () => {
      if (cancelled) return;

      const pads = navigator.getGamepads?.() ?? [];
      const gamepad = Array.from(pads).find(Boolean);
      if (gamepad) {
        const left = Boolean(gamepad.buttons[LEFT_BUTTON]?.pressed) || (gamepad.axes[0] ?? 0) < -STICK_DEADZONE;
        const right = Boolean(gamepad.buttons[RIGHT_BUTTON]?.pressed) || (gamepad.axes[0] ?? 0) > STICK_DEADZONE;
        const previous = previousStateRef.current;
        const now = performance.now();

        if ((left && !previous.left) || (right && !previous.right)) {
          movePreview(left ? -1 : 1);
        } else if ((left || right) && now - lastMoveAtRef.current >= REPEAT_DELAY_MS) {
          movePreview(left ? -1 : 1);
        }

        previousStateRef.current = { left, right };
      } else {
        previousStateRef.current = { left: false, right: false };
      }

      frameRef.current = window.requestAnimationFrame(poll);
    };

    frameRef.current = window.requestAnimationFrame(poll);
    return () => {
      cancelled = true;
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [selectedVideo?.url, setSelectedVideo, slots]);

  return null;
};