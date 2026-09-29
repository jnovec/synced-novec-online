import { useEffect, useRef } from 'react';
import { useToast } from '@chakra-ui/react';

type DocumentPictureInPictureAPI = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
};

export function usePagePip() {
  const toast = useToast();
  const windowRef = useRef<Window | null>(null);

  useEffect(() => () => {
    windowRef.current?.close();
  }, []);

  const open = async (url: string, title: string) => {
    const api = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureAPI }).documentPictureInPicture;
    if (!api) {
      toast({ title: 'Floating okno podporuje Chrome nebo Edge na počítači.', status: 'info' });
      return;
    }

    try {
      let target = windowRef.current;
      if (!target || target.closed) {
        target = await api.requestWindow({ width: 520, height: 760 });
        windowRef.current = target;
        target.addEventListener('pagehide', () => {
          windowRef.current = null;
        }, { once: true });
      }

      target.document.title = title;
      target.document.body.style.cssText = 'margin:0;background:#101d2a;color:#fff;font:14px system-ui,sans-serif;overflow:hidden';
      target.document.body.replaceChildren();

      const header = target.document.createElement('div');
      header.textContent = title;
      header.style.cssText = 'height:38px;display:flex;align-items:center;padding:0 12px;background:#172638;color:#8ed0ff;font-weight:700;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

      const frame = target.document.createElement('iframe');
      frame.src = url;
      frame.title = title;
      frame.style.cssText = 'display:block;width:100%;height:calc(100vh - 38px);border:0;background:#fff';
      frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');

      target.document.body.append(header, frame);
      target.focus();
    } catch {
      toast({ title: 'Originální stránku se nepodařilo otevřít ve floating okně.', status: 'warning' });
    }
  };

  return { open };
}
