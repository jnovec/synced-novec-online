import { useControlsContext } from '@/contexts/useControls';
import {
  AppSession,
  buildSessionShareUrl,
  getPastesIdFromLocation,
  normalizeAppSession,
  parsePastesId,
} from '@/lib/session';
import { DeleteIcon } from '@chakra-ui/icons';
import { Badge, Button, Flex, IconButton, Input, Text, useToast } from '@chakra-ui/react';
import { useEffect, useState } from 'react';

const SAVED_SESSIONS_KEY = 'multiscreenchaturbate-saved-sessions';
const PASTES_API_KEY_STORAGE = 'multiscreenchaturbate-pastes-api-key';

export const SessionSettings = () => {
  const toast = useToast();
  const { captureSession, loadSession } = useControlsContext();
  const [sessionName, setSessionName] = useState('');
  const [savedSessions, setSavedSessions] = useState<AppSession[]>([]);
  const [pastesApiKey, setPastesApiKey] = useState('');
  const [pasteReference, setPasteReference] = useState('');
  const [savingPaste, setSavingPaste] = useState(false);
  const [loadingPaste, setLoadingPaste] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(SAVED_SESSIONS_KEY) ?? '[]');
      if (Array.isArray(stored)) {
        setSavedSessions(stored.flatMap((item) => {
          try { return [normalizeAppSession(item)]; } catch { return []; }
        }));
      }
      setPastesApiKey(sessionStorage.getItem(PASTES_API_KEY_STORAGE) ?? '');
      const linkedPasteId = getPastesIdFromLocation(window.location);
      if (linkedPasteId) setPasteReference(buildSessionShareUrl(linkedPasteId));
    } catch {
      setSavedSessions([]);
    }
  }, []);

  const persistSessions = (sessions: AppSession[]) => {
    setSavedSessions(sessions);
    localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(sessions));
  };

  const handleLocalSave = () => {
    const session = captureSession(sessionName);
    const withoutSameName = savedSessions.filter((saved) => saved.name !== session.name);
    persistSessions([session, ...withoutSameName].slice(0, 30));
    setSessionName('');
    toast({ title: `Session „${session.name}“ uložena`, status: 'success', duration: 2200, isClosable: true });
  };

  const handleLoad = (session: AppSession) => {
    const loaded = loadSession(session);
    const hasDisplayWindows = loaded.slots.some((slot) => slot?.sourceType === 'display');
    toast({
      title: `Session „${loaded.name}“ načtena`,
      description: hasDisplayWindows ? 'Lokální okna je potřeba znovu vybrat tlačítkem Vyměnit.' : undefined,
      status: 'success',
      duration: hasDisplayWindows ? 4500 : 2200,
      isClosable: true,
    });
  };

  const handleDelete = (createdAt: string) => {
    persistSessions(savedSessions.filter((session) => session.createdAt !== createdAt));
  };

  const handlePastesSave = async () => {
    const apiKey = pastesApiKey.trim();
    if (!apiKey) {
      toast({ title: 'Nejdřív zadej Pastes.io API klíč', status: 'warning', duration: 2800, isClosable: true });
      return;
    }
    sessionStorage.setItem(PASTES_API_KEY_STORAGE, apiKey);
    setSavingPaste(true);
    try {
      const response = await fetch('/api/session-pastes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save', apiKey, session: captureSession(sessionName) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Pastes.io session se nepodařilo uložit.');
      const shareUrl = buildSessionShareUrl(result.id);
      setPasteReference(shareUrl);
      await navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
      toast({ title: 'Session uložena na Pastes.io', description: 'Sdílecí odkaz je zobrazený níže a zkopírovaný.', status: 'success', duration: 3500, isClosable: true });
    } catch (error) {
      toast({ title: 'Uložení na Pastes.io selhalo', description: error instanceof Error ? error.message : 'Neznámá chyba', status: 'error', duration: 4500, isClosable: true });
    } finally {
      setSavingPaste(false);
    }
  };

  const handlePastesLoad = async () => {
    if (!pasteReference.trim()) return;
    setLoadingPaste(true);
    try {
      const response = await fetch('/api/session-pastes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'load', apiKey: pastesApiKey.trim(), paste: pasteReference.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Pastes.io session se nepodařilo načíst.');
      handleLoad(normalizeAppSession(result.session));
      const pasteId = parsePastesId(pasteReference);
      if (pasteId) {
        const shareUrl = buildSessionShareUrl(pasteId);
        setPasteReference(shareUrl);
        window.history.replaceState(window.history.state, '', buildSessionShareUrl(pasteId, window.location.origin));
      }
    } catch (error) {
      toast({ title: 'Načtení z Pastes.io selhalo', description: error instanceof Error ? error.message : 'Neznámá chyba', status: 'error', duration: 4500, isClosable: true });
    } finally {
      setLoadingPaste(false);
    }
  };

  return (
    <Flex flexDir="column" alignItems="stretch" gap="2" py="1">
      <Flex justifyContent="space-between" alignItems="center">
        <Text fontSize="sm" fontWeight="semibold">Session</Text>
        <Badge colorScheme="blue">{savedSessions.length} uložených</Badge>
      </Flex>
      <Input size="sm" value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder="Název session" bg="black" borderColor="whiteAlpha.400" />
      <Button size="xs" colorScheme="blue" onClick={handleLocalSave}>Uložit aktuální session</Button>

      {savedSessions.map((session) => (
        <Flex key={session.createdAt} alignItems="center" gap="1" borderWidth="1px" borderColor="whiteAlpha.200" borderRadius="md" p="1">
          <Button size="xs" variant="ghost" flex="1" justifyContent="flex-start" noOfLines={1} onClick={() => handleLoad(session)}>
            {session.name}
          </Button>
          <IconButton size="xs" aria-label={`Smazat session ${session.name}`} icon={<DeleteIcon />} colorScheme="red" variant="ghost" onClick={() => handleDelete(session.createdAt)} />
        </Flex>
      ))}

      <Text mt="1" fontSize="xs" fontWeight="semibold">Pastes.io úložiště</Text>
      <Input
        type="password"
        size="sm"
        value={pastesApiKey}
        onChange={(event) => {
          const value = event.target.value;
          setPastesApiKey(value);
          if (value.trim()) sessionStorage.setItem(PASTES_API_KEY_STORAGE, value.trim());
          else sessionStorage.removeItem(PASTES_API_KEY_STORAGE);
        }}
        placeholder="Pastes.io API klíč"
        bg="black"
        borderColor="whiteAlpha.400"
        autoComplete="off"
      />
      <Button size="xs" colorScheme="orange" onClick={() => void handlePastesSave()} isLoading={savingPaste} loadingText="Ukládám…">Uložit na Pastes.io</Button>
      <Input size="sm" value={pasteReference} onChange={(event) => setPasteReference(event.target.value)} placeholder="Pastes.io odkaz nebo ID" bg="black" borderColor="whiteAlpha.400" />
      <Button size="xs" variant="outline" colorScheme="orange" onClick={() => void handlePastesLoad()} isLoading={loadingPaste} isDisabled={!pasteReference.trim()} loadingText="Načítám…">Načíst z Pastes.io</Button>
      <Text fontSize="xs" color="gray.500">Sdílecí odkaz má tvar synced.novec.online/?session=ID a po otevření načte session automaticky.</Text>
      <Text fontSize="xs" color="gray.500">Klíč zůstává jen v této kartě prohlížeče a není součástí odkazu, session ani zdrojových souborů.</Text>
    </Flex>
  );
};
