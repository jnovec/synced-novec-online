import { audioLevelToVibration, findVibrationGamepad, stopGamepadVibration, vibrateGamepad } from '@/lib/gamepadVibration';
import { useEffect, useRef, useState } from 'react';

export type GamepadVibrationStatus = 'off' | 'running' | 'no-audio' | 'no-gamepad' | 'unsupported' | 'error';

export const useAudioGamepadVibration = ({
  stream,
  enabled,
  sensitivity,
}: {
  stream: MediaStream | null;
  enabled: boolean;
  sensitivity: number;
}) => {
  const [status, setStatus] = useState<GamepadVibrationStatus>('off');
  const [level, setLevel] = useState(0);
  const sensitivityRef = useRef(sensitivity);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      setLevel(0);
      return;
    }
    if (!stream?.getAudioTracks().length) {
      setStatus('no-audio');
      return;
    }
    if (typeof window === 'undefined' || !window.AudioContext || !navigator.getGamepads) {
      setStatus('unsupported');
      return;
    }

    const gamepad = findVibrationGamepad();
    if (!gamepad) {
      setStatus('no-gamepad');
      return;
    }

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.68;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let timer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;
    let smoothed = 0;

    void audioContext.resume().then(() => {
      if (disposed) return;
      setStatus('running');
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (let index = 0; index < samples.length; index += 1) sumSquares += samples[index] ** 2;
        const rms = Math.sqrt(sumSquares / samples.length);
        const target = audioLevelToVibration(rms, sensitivityRef.current);
        smoothed = smoothed * 0.55 + target * 0.45;
        setLevel(smoothed);
        void vibrateGamepad(gamepad, {
          duration: 95,
          strongMagnitude: smoothed,
          weakMagnitude: Math.min(1, smoothed * 1.2),
        }).catch(() => setStatus('error'));
      }, 80);
    }).catch(() => setStatus('error'));

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close();
      void stopGamepadVibration(gamepad);
      setLevel(0);
    };
  }, [enabled, stream]);

  return { status, level };
};
