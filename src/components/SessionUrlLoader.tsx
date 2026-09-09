import { useControlsContext } from '@/contexts/useControls';
import { getPastesIdFromLocation, normalizeAppSession } from '@/lib/session';
import { useToast } from '@chakra-ui/react';
import { useEffect } from 'react';

const PASTES_API_KEY_STORAGE = 'multiscreenchaturbate-pastes-api-key';

export const SessionUrlLoader = () => {
  const { loadSession } = useControlsContext();
  const toast = useToast();

  useEffect(() => {
    const pasteId = getPastesIdFromLocation(window.location);
    if (!pasteId) return;

    const controller = new AbortController();
    let cancelled = false;

    const loadLinkedSession = async () => {
      try {
        const response = await fetch('/api/session-pastes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'load',
            apiKey: sessionStorage.getItem(PASTES_API_KEY_STORAGE) ?? '',
            paste: pasteId,
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Pastes.io session se nepodařilo načíst.');
        if (cancelled) return;

        const loaded = loadSession(normalizeAppSession(result.session));
        const hasDisplayWindows = loaded.slots.some((slot) => slot?.sourceType === 'display');
        toast({
          title: `Session „${loaded.name}“ načtena z odkazu`,
          description: hasDisplayWindows ? 'Lokální okna je potřeba znovu vybrat tlačítkem Vyměnit.' : undefined,
          status: 'success',
          duration: hasDisplayWindows ? 5000 : 2800,
          isClosable: true,
        });
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        toast({
          title: 'Session z odkazu se nepodařilo načíst',
          description: error instanceof Error ? error.message : 'Neznámá chyba',
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      }
    };

    void loadLinkedSession();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Odkaz se načítá právě jednou při otevření aplikace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};
