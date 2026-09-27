import { useControlsContext } from '@/contexts/useControls';
import { encodeSyncUrl } from '@/lib/session';
import { Button, Flex, Text, useToast } from '@chakra-ui/react';

export const SyncUrlBar = () => {
  const { captureSession } = useControlsContext();
  const toast = useToast();
  const createUrl = async () => {
    const payload = {
      session: captureSession('SYNC session'),
      channels: localStorage.getItem('video-source-channels-v3'),
      preferences: localStorage.getItem('synced-sidebar-preferences'),
    };
    const url = `${window.location.origin}/?sync=${encodeSyncUrl(payload)}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    toast({ title: 'SYNC URL zkopírována', description: 'Po otevření se načte stejná session a nastavení.', status: 'success', duration: 3000, isClosable: true });
  };
  return <Flex position="fixed" top="8px" left="50%" transform="translateX(-50%)" zIndex={1100} alignItems="center" gap="2" bg="blackAlpha.800" borderRadius="md" px="2" py="1">
    <Text color="gray.300" fontSize="xs" fontWeight="bold">SYNC URL:</Text>
    <Button size="xs" colorScheme="purple" onClick={() => void createUrl()}>Zkopírovat odkaz</Button>
  </Flex>;
};
