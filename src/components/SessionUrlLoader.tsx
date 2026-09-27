import { useControlsContext } from '@/contexts/useControls';
import { decodeSyncUrl, getPastesIdFromLocation, normalizeAppSession } from '@/lib/session';
import { useToast } from '@chakra-ui/react';
import { useEffect } from 'react';

const PASTES_API_KEY_STORAGE = 'multiscreenchaturbate-pastes-api-key';

export const SessionUrlLoader = () => {
  const { loadSession } = useControlsContext();
  const toast = useToast();

  useEffect(() => {
    const sync = new URLSearchParams(window.location.search).get('sync');
    if (sync) {
      try {
        const payload = decodeSyncUrl(sync) as { session?: unknown; channels?: string | null; preferences?: string | null };
        const reloadedForSync = sessionStorage.getItem('synced-sync-reloaded') === '1';
        if (payload.channels) localStorage.setItem('video-source-channels-v3', payload.channels);
        if (payload.preferences) localStorage.setItem('synced-sidebar-preferences', payload.preferences);
        if (payload.channels && !reloadedForSync) {
          sessionStorage.setItem('synced-sync-reloaded', '1');
          window.location.reload();
          return;
        }
        sessionStorage.removeItem('synced-sync-reloaded');
        if (payload.session) loadSession(payload.session);
        toast({ title: 'SYNC session načtena z odkazu', status: 'success', duration: 2800, isClosable: true });
      } catch { toast({ title: 'SYNC URL není platná', status: 'error', duration: 3500, isClosable: true }); }
      return;
    }
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
