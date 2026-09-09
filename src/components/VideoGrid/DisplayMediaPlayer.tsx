import { useEffect, useRef } from 'react';

interface DisplayMediaPlayerProps {
  stream: MediaStream;
  muted: boolean;
  volume: number;
}

export const DisplayMediaPlayer = ({ stream, muted, volume }: DisplayMediaPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.srcObject = stream;
    void video.play().catch(() => {
      // Playback will resume after the next user interaction if autoplay is blocked.
    });

    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume;
  }, [muted, volume]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      aria-label="Sdílené okno aplikace"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        background: 'black',
        pointerEvents: 'none',
      }}
    />
  );
};
