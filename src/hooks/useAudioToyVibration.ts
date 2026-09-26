import { useButtplugContext } from '@/contexts/useButtplug';
import { audioLevelToVibration } from '@/lib/gamepadVibration';
import { useEffect, useRef, useState } from 'react';

export type ToyVibrationStatus = 'off' | 'running' | 'no-audio' | 'no-toy' | 'unsupported' | 'error';
export const useAudioToyVibration = ({ stream, enabled, sensitivity, deviceIndex }: { stream: MediaStream | null; enabled: boolean; sensitivity: number; deviceIndex: number | null }) => {
  const { vibrateDevice, stopDevice, devices } = useButtplugContext();
  const [status, setStatus] = useState<ToyVibrationStatus>('off');
  const [level, setLevel] = useState(0);
  const sensitivityRef = useRef(sensitivity);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => {
    if (!enabled) { setStatus('off'); setLevel(0); return; }
    if (!stream?.getAudioTracks().length) { setStatus('no-audio'); return; }
    if (typeof window === 'undefined' || !window.AudioContext) { setStatus('unsupported'); return; }
    if (deviceIndex === null || !devices.some((device) => device.index === deviceIndex)) { setStatus('no-toy'); return; }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.68;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let smoothed = 0;
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value ** 2, 0) / samples.length);
      smoothed = smoothed * 0.55 + audioLevelToVibration(rms, sensitivityRef.current) * 0.45;
      setLevel(smoothed);
      void vibrateDevice(deviceIndex, smoothed).catch(() => setStatus('error'));
    }, 100);
    void context.resume().then(() => setStatus('running')).catch(() => setStatus('error'));
    return () => { window.clearInterval(timer); source.disconnect(); analyser.disconnect(); void context.close(); void stopDevice(deviceIndex).catch(() => undefined); setLevel(0); };
  }, [devices, deviceIndex, enabled, stream, stopDevice, vibrateDevice]);
  return { status, level };
};
