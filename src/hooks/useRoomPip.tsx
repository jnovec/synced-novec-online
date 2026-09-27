import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactPlayer from 'react-player';
import { useToast } from '@chakra-ui/react';
import { resolveRemoteStreamUrl } from '@/lib/remoteVideo';

type Room = { url: string; name: string; logo?: string };
type PipAPI = { requestWindow: (options: { width: number; height: number }) => Promise<Window> };

export function useRoomPip() {
  const toast = useToast();
  const windowRef = useRef<Window | null>(null);
  const requestId = useRef(0);
  const opening = useRef(false);
  const [pip, setPip] = useState<Window | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [stream, setStream] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => () => {
    requestId.current++;
    windowRef.current?.close();
  }, []);

  const open = async (nextRoom: Room) => {
    const api = (window as Window & { documentPictureInPicture?: PipAPI }).documentPictureInPicture;
    if (!api) {
      toast({ title: 'Tento prohlížeč nepodporuje PiP okno. Zkus Chrome nebo Edge na počítači.', status: 'info' });
      return;
    }
    if (opening.current) return;
    const id = ++requestId.current;
    try {
      opening.current = true;
      // Request synchronously from the click, before resolving the stream URL.
      let target = windowRef.current;
      if (!target || target.closed) {
        target = await api.requestWindow({ width: 640, height: 400 });
        if (id !== requestId.current) { target.close(); return; }
        windowRef.current = target;
        target.document.body.style.cssText = 'margin:0;background:#000;color:white;font:14px system-ui';
        target.addEventListener('pagehide', () => {
          requestId.current++;
          windowRef.current = null;
          setPip(null);
          setStream(null);
        }, { once: true });
      }
      target.document.title = nextRoom.name;
      setRoom(nextRoom);
      setStream(null);
      setError(false);
      setPip(target);
      opening.current = false;
      const resolved = await resolveRemoteStreamUrl(nextRoom.url);
      if (id !== requestId.current || target.closed) return;
      setStream(resolved);
      setError(!resolved);
    } catch {
      if (id === requestId.current) {
        setError(true);
        toast({ title: 'PiP se nepodařilo otevřít nebo načíst. Zkus náhled znovu.', status: 'warning' });
      }
    } finally {
      opening.current = false;
    }
  };

  const close = () => {
    requestId.current++;
    windowRef.current?.close();
    windowRef.current = null;
    setPip(null);
    setRoom(null);
    setStream(null);
  };

  const portal = pip && room ? createPortal(
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8 }}>{room.name}</div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {stream && !error ? <ReactPlayer key={stream} url={stream} playing muted controls playsinline width="100%" height="100%" onError={() => setError(true)} /> : <>
          {room.logo && <img src={room.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 0.5 }} />}
          <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            {error ? <button onClick={() => void open(room)}>Stream není dostupný — zkusit znovu</button> : 'Načítám stream…'}
          </div>
        </>}
      </div>
    </div>, pip.document.body) : null;
  return { open, close, portal };
}
