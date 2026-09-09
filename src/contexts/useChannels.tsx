import { useLocalStorage } from '@/hooks/useLocalStorage';
import { mergeCurrentRooms } from '@/lib/channelCatalog';
import posthog from 'posthog-js';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

interface ChannelsContextInterface {
  channels: ChannelsObj;
  isRefreshing: boolean;
  lastUpdatedAt: number | null;
  refreshError: string | null;
  addCategory: (newCategoryName: string) => void;
  deleteCategory: (deleteCategoryName: string) => void;
  addChannel: (
    addChannelCategory: string,
    newChannelName: string,
    newChannelLocation: string,
    newChannelUrl: string,
    newChannelLogo: string
  ) => void;
  deleteChannel: (deleteChannelCategory: string, deleteChannelUrl: string) => void;
  clearChannels: () => void;
  getMasterChannels: () => Promise<void>;
  getAusTvChannels: () => Promise<void>;
  importPlaylist: (playlistUrl: string) => Promise<number>;
}

const DEFAULT_CATEGORY = 'Chaturbate';
const CHANNELOUT_STORAGE_KEY = 'chaturbate-popular-channels-v2';
const POPULAR_PAGE_COUNT = 5;
const PAGE_DELAY_MS = 100;

export const ChannelsContextProvider = ({ children }: ChannelsContextProviderProps) => {
  const { getLocalStorage, setLocalStorage } = useLocalStorage();
  const [channels, setChannelsHook] = useState<ChannelsObj>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const savedChannels = getLocalStorage(CHANNELOUT_STORAGE_KEY);
    if (
      savedChannels &&
      isChannelsObj(savedChannels) &&
      Object.values(savedChannels).some((savedGroup) => savedGroup.length > 0)
    ) {
      setChannelsHook(savedChannels);
    }
    void getAusTvChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistChannels = (next: ChannelsObj) => {
    setChannelsHook(next);
    setLocalStorage(CHANNELOUT_STORAGE_KEY, next);
  };

  const setChannels = (newChannels: ChannelsObj) => persistChannels(newChannels);

  const appendRooms = (rooms: ChaturbateRoom[]) => {
    setChannelsHook((prev) => {
      const existing = prev[DEFAULT_CATEGORY] ?? [];
      const merged = dedupeByUrl([
        ...existing,
        ...rooms.map((room) => ({
          name: room.name,
          location: room.location,
          url: room.url,
          logo: room.logo,
          viewers: room.viewers,
        })),
      ]);
      const next = { ...prev, [DEFAULT_CATEGORY]: merged };
      setLocalStorage(CHANNELOUT_STORAGE_KEY, next);
      return next;
    });
  };

  const addCategory = (newCategoryName: string) => {
    const newChannelsObject = {
      ...channels,
      [newCategoryName]: [],
    };

    posthog.capture('category_added', {
      category_name: newCategoryName,
    });

    return setChannels(newChannelsObject);
  };

  const deleteCategory = (deleteCategoryName: string) => {
    const newChannelsObject = { ...channels };
    delete newChannelsObject[deleteCategoryName];

    posthog.capture('category_deleted', {
      category_name: deleteCategoryName,
    });

    return setChannels(newChannelsObject);
  };

  const addChannel = (
    addChannelCategory: string,
    newChannelName: string,
    newChannelLocation: string,
    newChannelUrl: string,
    newChannelLogo: string
  ) => {
    const newChannelsObject = { ...channels };

    newChannelsObject[addChannelCategory] = [
      ...(newChannelsObject[addChannelCategory] ?? []),
      {
        name: newChannelName,
        location: newChannelLocation,
        url: newChannelUrl,
        logo: newChannelLogo,
      },
    ];

    posthog.capture('channel_added', {
      category_name: addChannelCategory,
      channel_name: newChannelName,
      channel_location: newChannelLocation,
      channel_url: newChannelUrl,
      channel_logo: newChannelLogo,
    });

    return setChannels(newChannelsObject);
  };

  const deleteChannel = (deleteChannelCategory: string, deleteChannelUrl: string) => {
    const newChannelsObject = { ...channels };
    const newChannels = [...newChannelsObject[deleteChannelCategory]];

    const filteredChannels = newChannels.filter((channel) => channel.url !== deleteChannelUrl);
    newChannelsObject[deleteChannelCategory] = filteredChannels;

    posthog.capture('channel_deleted', {
      category_name: deleteChannelCategory,
      channel_url: deleteChannelUrl,
    });

    return setChannels(newChannelsObject);
  };

  const clearChannels = () => {
    posthog.capture('channels_cleared');
    return setChannels({});
  };

  const getMasterChannels = async () => {
    return getAusTvChannels();
  };

  const getAusTvChannels = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);
    setRefreshError(null);

    try {
      const successfulPages: ChaturbateRoom[][] = [];
      for (let page = 1; page <= POPULAR_PAGE_COUNT; page += 1) {
        try {
          const next = await fetchRoomPage(page);
          successfulPages.push(next.rooms);
        } catch (error) {
          console.warn(`Chaturbate page ${page} failed`, error);
        }
        await sleep(PAGE_DELAY_MS);
      }

      const currentRooms = mergeCurrentRooms(successfulPages);
      if (!currentRooms.length) throw new Error('Nepodařilo se načíst žádnou stránku aktuálních streamů.');

      persistChannels({ [DEFAULT_CATEGORY]: currentRooms.map(roomToChannel) });
      setLastUpdatedAt(Date.now());
    } catch (error) {
      console.error('Failed to load Chaturbate rooms', error);
      setRefreshError(error instanceof Error ? error.message : 'Načtení streamů selhalo.');
    } finally {
      refreshingRef.current = false;
      setIsRefreshing(false);
    }
  };

  const importPlaylist = async (playlistUrl: string): Promise<number> => {
    const response = await fetch('/api/chaturbate-playlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: playlistUrl }),
    });
    const data = (await response.json()) as { rooms?: ChaturbateRoom[]; error?: string };
    if (!response.ok || !data.rooms) throw new Error(data.error ?? `HTTP ${response.status}`);

    appendRooms(data.rooms);
    return data.rooms.length;
  };

  const providerValue: ChannelsContextInterface = {
    channels,
    isRefreshing,
    lastUpdatedAt,
    refreshError,
    addCategory,
    deleteCategory,
    addChannel,
    deleteChannel,
    clearChannels,
    getMasterChannels,
    getAusTvChannels,
    importPlaylist,
  };

  return <ChannelsContext.Provider value={providerValue}>{children}</ChannelsContext.Provider>;
};

async function fetchRoomPage(page: number): Promise<ChaturbatePage> {
  const response = await fetch(`/api/chaturbate?page=${page}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as ChaturbatePage;
}

function roomToChannel(room: ChaturbateRoom) {
  return {
    name: room.name,
    location: room.location,
    url: room.url,
    logo: room.logo,
    viewers: room.viewers,
  };
}

function dedupeByUrl(channels: Channel[]): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const channel of channels) {
    if (seen.has(channel.url)) continue;
    seen.add(channel.url);
    out.push(channel);
  }
  return out.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
}

function sortRoomsByViewers(rooms: ChaturbateRoom[]): ChaturbateRoom[] {
  return [...rooms].sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------------------------------
// Interfaces
// -------------------------------------------
interface ChaturbatePage {
  rooms: ChaturbateRoom[];
  total_count: number;
  page: number;
}

interface ChaturbateRoom {
  name: string;
  location: string;
  url: string;
  logo: string;
  viewers?: number;
}

interface ChannelsObj {
  [key: string]: Channel[];
}

export interface Channel {
  name: string;
  location: string;
  url: string;
  logo: string;
  viewers?: number;
}

const isChannelsObj = (value: unknown): value is ChannelsObj => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((channels) =>
    Array.isArray(channels)
      ? channels.every(
          (channel) =>
            channel &&
            typeof channel === 'object' &&
            typeof (channel as Channel).name === 'string' &&
            typeof (channel as Channel).url === 'string'
        )
      : false
  );
};

const ChannelsContext = createContext<ChannelsContextInterface>({} as ChannelsContextInterface);

export const useChannelsContext = () => {
  return useContext(ChannelsContext);
};

interface ChannelsContextProviderProps {
  children: React.ReactNode;
}
