import {
  GamepadWithVibration,
  gamepadSupportsVibration,
  getConnectedGamepads,
  vibrateGamepad,
} from '@/lib/gamepadVibration';
import { Badge, Box, Button, Flex, Text, useToast } from '@chakra-ui/react';
import { useCallback, useEffect, useState } from 'react';

const DETECTION_TIME_MS = 12_000;

export const GamepadSettings = () => {
  const toast = useToast();
  const [gamepads, setGamepads] = useState<GamepadWithVibration[]>([]);
  const [detecting, setDetecting] = useState(false);

  const refresh = useCallback(() => {
    setGamepads(getConnectedGamepads());
  }, []);

  useEffect(() => {
    refresh();
    const handleConnectionChange = () => refresh();
    window.addEventListener('gamepadconnected', handleConnectionChange);
    window.addEventListener('gamepaddisconnected', handleConnectionChange);
    const polling = window.setInterval(refresh, 1000);

    return () => {
      window.removeEventListener('gamepadconnected', handleConnectionChange);
      window.removeEventListener('gamepaddisconnected', handleConnectionChange);
      window.clearInterval(polling);
    };
  }, [refresh]);

  const handleDetect = () => {
    if (!navigator.getGamepads) {
      toast({ title: 'Gamepad API není podporované', description: 'Otevři aplikaci v aktuálním Chromu.', status: 'error', duration: 3500, isClosable: true });
      return;
    }

    setDetecting(true);
    refresh();
    toast({
      title: 'Čekám na ovladač',
      description: 'Zapni ovladač a několikrát stiskni A nebo jiné tlačítko.',
      status: 'info',
      duration: 4000,
      isClosable: true,
    });
    window.setTimeout(() => {
      refresh();
      setDetecting(false);
    }, DETECTION_TIME_MS);
  };

  const handleTest = async (gamepad: GamepadWithVibration) => {
    try {
      const supported = await vibrateGamepad(gamepad, { duration: 700, strongMagnitude: 0.85, weakMagnitude: 0.65 });
      toast({
        title: supported ? 'Test vibrace odeslán' : 'Tento ovladač vibrace přes prohlížeč nenabízí',
        status: supported ? 'success' : 'warning',
        duration: 2800,
        isClosable: true,
      });
    } catch {
      toast({ title: 'Vibraci se nepodařilo spustit', status: 'error', duration: 2800, isClosable: true });
    }
  };

  return (
    <Flex flexDir="column" alignItems="stretch" gap="2" py="1">
      <Flex justifyContent="space-between" alignItems="center" gap="2">
        <Text fontSize="sm" fontWeight="semibold">Ovladač</Text>
        <Badge colorScheme={gamepads.length ? 'green' : detecting ? 'orange' : 'gray'}>
          {gamepads.length ? 'Připojen' : detecting ? 'Hledám…' : 'Nepřipojen'}
        </Badge>
      </Flex>

      {gamepads.map((gamepad) => (
        <Box key={gamepad.index} borderWidth="1px" borderColor="whiteAlpha.300" borderRadius="md" p="2" bg="blackAlpha.300">
          <Text fontSize="xs" fontWeight="semibold" noOfLines={2}>{gamepad.id || `Gamepad ${gamepad.index + 1}`}</Text>
          <Flex mt="2" justifyContent="space-between" alignItems="center" gap="2">
            <Badge colorScheme={gamepadSupportsVibration(gamepad) ? 'pink' : 'yellow'} fontSize="0.62rem">
              {gamepadSupportsVibration(gamepad) ? 'Vibrace podporovány' : 'Bez webových vibrací'}
            </Badge>
            <Button
              size="xs"
              colorScheme="pink"
              onClick={() => void handleTest(gamepad)}
              isDisabled={!gamepadSupportsVibration(gamepad)}
            >
              Test vibrace
            </Button>
          </Flex>
        </Box>
      ))}

      {!gamepads.length && (
        <Text fontSize="xs" color="gray.400">
          Připoj ovladač přes Bluetooth nebo USB a stiskni na něm tlačítko, aby ho Chrome zpřístupnil stránce.
        </Text>
      )}
      <Button size="xs" colorScheme="purple" onClick={handleDetect} isLoading={detecting} loadingText="Čekám na tlačítko…">
        Připojit / detekovat ovladač
      </Button>
    </Flex>
  );
};
