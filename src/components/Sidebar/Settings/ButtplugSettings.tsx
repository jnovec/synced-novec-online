import { useButtplugContext } from '@/contexts/useButtplug';
import { Badge, Box, Button, Divider, Flex, Input, Link, Text, useToast } from '@chakra-ui/react';

const labels = { disconnected: 'Nepřipojeno', connecting: 'Připojuji…', connected: 'Připojeno', error: 'Chyba' };
const canAttemptBluetooth = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!window.isSecureContext) return false;
  return /Chrome|Edg\//i.test(navigator.userAgent) && !/Android|Mobile|CriOS|EdgiOS/i.test(navigator.userAgent);
};

export const ButtplugSettings = () => {
  const toast = useToast();
  const { status, errorMessage, connectionMethod, serverUrl, setServerUrl, devices, isScanning, connectViaIntiface, connectViaBluetooth, disconnect, startScanning, stopScanning, vibrateDevice, stopDevice } = useButtplugContext();
  const test = async (index: number) => {
    try { await vibrateDevice(index, 0.7); window.setTimeout(() => void stopDevice(index), 700); toast({ title: 'Test vibrace odeslán', status: 'success', duration: 1800 }); }
    catch { toast({ title: 'Hračka příkaz odmítla', status: 'error', duration: 2200 }); }
  };
  return <Flex direction="column" gap="2" py="1">
    <Flex justifyContent="space-between"><Text fontSize="sm" fontWeight="semibold">Hračky (Bluetooth)</Text><Badge colorScheme={status === 'connected' ? 'green' : status === 'error' ? 'red' : 'gray'}>{labels[status]}</Badge></Flex>
    {connectionMethod && status === 'connected' && <Text fontSize="xs" color="gray.400">Připojeno {connectionMethod === 'bluetooth' ? 'přes Bluetooth' : 'přes Intiface Central'}.</Text>}
    {errorMessage && status === 'error' && <Text fontSize="xs" color="red.300">{errorMessage}</Text>}
    {status === 'connected' ? <><Button size="xs" colorScheme="red" onClick={() => void disconnect()}>Odpojit</Button><Button size="xs" variant="outline" onClick={() => void (isScanning ? stopScanning() : startScanning())}>{isScanning ? 'Zastavit skenování' : 'Skenovat hračky'}</Button>{devices.map((device) => <Box key={device.index} borderWidth="1px" borderColor="whiteAlpha.300" borderRadius="md" p="2"><Text fontSize="xs" fontWeight="semibold">{device.name}</Text><Button mt="2" size="xs" colorScheme="pink" onClick={() => void test(device.index)} isDisabled={!device.vibrateAttributes.length}>Test vibrace</Button></Box>)}</> : <><Box borderWidth="1px" borderColor="whiteAlpha.300" borderRadius="md" p="2"><Text fontSize="xs" fontWeight="semibold" mb="1">Bluetooth přímo v prohlížeči</Text><Text fontSize="xs" color="gray.400" mb="2">Funguje v Chrome/Edge na počítači bez Intiface Central.</Text><Button size="xs" colorScheme="purple" w="full" onClick={() => void connectViaBluetooth()} isDisabled={!canAttemptBluetooth()} isLoading={status === 'connecting'}>Připojit přes Bluetooth</Button></Box><Divider borderColor="whiteAlpha.300" /><Box borderWidth="1px" borderColor="whiteAlpha.300" borderRadius="md" p="2"><Text fontSize="xs" fontWeight="semibold" mb="1">Intiface Central</Text><Text fontSize="xs" color="gray.400" mb="2">Vyžaduje spuštěný <Link href="https://intiface.com/central" isExternal color="cyan.300">Intiface Central</Link>.</Text><Input size="xs" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} mb="2" /><Button size="xs" variant="outline" colorScheme="purple" w="full" onClick={() => void connectViaIntiface()} isLoading={status === 'connecting'}>Připojit přes Intiface</Button></Box></>}
  </Flex>;
};
