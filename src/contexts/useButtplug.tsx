import { ButtplugBrowserWebsocketClientConnector, ButtplugClient, ButtplugClientDevice } from 'buttplug';
import { ButtplugWasmClientConnector } from 'buttplug-wasm/dist/buttplug-wasm.mjs';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type ButtplugConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type ButtplugConnectionMethod = 'websocket' | 'bluetooth' | null;
export const DEFAULT_INTIFACE_URL = 'ws://127.0.0.1:12345';

interface ButtplugContextValue {
  status: ButtplugConnectionStatus;
  errorMessage: string | null;
  connectionMethod: ButtplugConnectionMethod;
  serverUrl: string;
  setServerUrl: (url: string) => void;
  devices: ButtplugClientDevice[];
  isScanning: boolean;
  connectViaIntiface: () => Promise<void>;
  connectViaBluetooth: () => Promise<void>;
  disconnect: () => Promise<void>;
  startScanning: () => Promise<void>;
  stopScanning: () => Promise<void>;
  vibrateDevice: (deviceIndex: number, level: number) => Promise<void>;
  stopDevice: (deviceIndex: number) => Promise<void>;
}

const ButtplugContext = createContext<ButtplugContextValue | null>(null);

export const ButtplugContextProvider = ({ children }: { children: ReactNode }) => {
  const clientRef = useRef<ButtplugClient | null>(null);
  const [status, setStatus] = useState<ButtplugConnectionStatus>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectionMethod, setConnectionMethod] = useState<ButtplugConnectionMethod>(null);
  const [serverUrl, setServerUrl] = useState(DEFAULT_INTIFACE_URL);
  const [devices, setDevices] = useState<ButtplugClientDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const getClient = useCallback(() => {
    if (clientRef.current) return clientRef.current;
    const client = new ButtplugClient('MultiScreen');
    const syncDevices = () => setDevices([...client.devices]);
    client.addListener('deviceadded', syncDevices);
    client.addListener('deviceremoved', syncDevices);
    client.addListener('scanningfinished', () => setIsScanning(false));
    client.addListener('disconnect', () => {
      setStatus('disconnected');
      setConnectionMethod(null);
      setDevices([]);
      setIsScanning(false);
    });
    clientRef.current = client;
    return client;
  }, []);

  const connect = useCallback(async (connector: any, method: ButtplugConnectionMethod) => {
    const client = getClient();
    if (client.connected) return;
    setStatus('connecting');
    setErrorMessage(null);
    try {
      await client.connect(connector);
      setStatus('connected');
      setConnectionMethod(method);
      setDevices([...client.devices]);
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Připojení se nezdařilo.');
    }
  }, [getClient]);

  const connectViaIntiface = useCallback(
    () => connect(new ButtplugBrowserWebsocketClientConnector(serverUrl), 'websocket'),
    [connect, serverUrl]
  );
  const connectViaBluetooth = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
      setStatus('error');
      setErrorMessage('Tento prohlížeč nepodporuje Web Bluetooth. Použij Chrome nebo Edge na počítači.');
      return;
    }
    await connect(new ButtplugWasmClientConnector(), 'bluetooth');
  }, [connect]);

  const disconnect = useCallback(async () => {
    if (!clientRef.current?.connected) return;
    await clientRef.current.disconnect();
    setStatus('disconnected');
    setConnectionMethod(null);
    setDevices([]);
  }, []);
  const startScanning = useCallback(async () => {
    if (!clientRef.current?.connected) return;
    setIsScanning(true);
    await clientRef.current.startScanning();
  }, []);
  const stopScanning = useCallback(async () => {
    if (!clientRef.current?.connected) return;
    await clientRef.current.stopScanning();
    setIsScanning(false);
  }, []);
  const vibrateDevice = useCallback(async (deviceIndex: number, level: number) => {
    const device = clientRef.current?.devices.find((candidate) => candidate.index === deviceIndex);
    if (device?.vibrateAttributes.length) await device.vibrate(Math.max(0, Math.min(1, level)));
  }, []);
  const stopDevice = useCallback(async (deviceIndex: number) => {
    const device = clientRef.current?.devices.find((candidate) => candidate.index === deviceIndex);
    if (device) await device.stop();
  }, []);

  useEffect(() => () => { void clientRef.current?.disconnect().catch(() => undefined); }, []);
  return <ButtplugContext.Provider value={{ status, errorMessage, connectionMethod, serverUrl, setServerUrl, devices, isScanning, connectViaIntiface, connectViaBluetooth, disconnect, startScanning, stopScanning, vibrateDevice, stopDevice }}>{children}</ButtplugContext.Provider>;
};

export const useButtplugContext = () => {
  const context = useContext(ButtplugContext);
  if (!context) throw new Error('useButtplugContext must be used within ButtplugContextProvider');
  return context;
};
