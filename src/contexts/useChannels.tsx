import { useLocalStorage } from '@/hooks/useLocalStorage';
import posthog from 'posthog-js';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

interface ChannelsContextInterface {
  channels: ChannelsObj;
  isLoadingSource: boolean;
  lastUpdatedAt: number | null;
  sourceError: string | null;
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
  loadSource: (sourceUrl: string) => Promise<SourceLoadResult>;
  importPlaylist: (playlistUrl: string) => Promise<number>;
}

const DEFAULT_CATEGORY = 'chaturbate.com';
const CHANNELOUT_STORAGE_KEY = 'video-source-channels-v3';

export const ChannelsContextProvider = ({ children }: ChannelsContextProviderProps) => {
  const { getLocalStorage, setLocalStorage } = useLocalStorage();
  const [channels, setChannelsHook] = useState<ChannelsObj>({});
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const loadingSourceRef = useRef(false);

  useEffect(() => {
    const savedChannels = getLocalStorage(CHANNELOUT_STORAGE_KEY);
    if (
      savedChannels &&
      isChannelsObj(savedChannels) &&
      Object.values(savedChannels).some((savedGroup) => savedGroup.length > 0)
    ) {
      setChannelsHook(savedChannels);
    }
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

  const loadSource = async (sourceUrl: string): Promise<SourceLoadResult> => {
    if (loadingSourceRef.current) throw new Error('Jiný zdroj se právě načítá.');
    loadingSourceRef.current = true;
    setIsLoadingSource(true);
    setSourceError(null);

    try {
      const response = await fetch('/api/video-source', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl }),
      });
      const data = (await response.json()) as SourceApiResponse;
      if (!response.ok || !data.category || !Array.isArray(data.channels)) {
        throw new Error(sourceErrorMessage(data.error, response.status));
      }

      const nextChannels = dedupeByUrl(data.channels);
      setChannelsHook((previous) => {
        const next = { ...previous, [data.category as string]: nextChannels };
        setLocalStorage(CHANNELOUT_STORAGE_KEY, next);
        return next;
      });
      setLastUpdatedAt(Date.now());
      posthog.capture('source_loaded', { source: data.category, channel_count: nextChannels.length });
      return { category: data.category, count: nextChannels.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Načtení zdroje selhalo.';
      setSourceError(message);
      throw error;
    } finally {
      loadingSourceRef.current = false;
      setIsLoadingSource(false);
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
    isLoadingSource,
    lastUpdatedAt,
    sourceError,
    addCategory,
    deleteCategory,
    addChannel,
    deleteChannel,
    clearChannels,
    loadSource,
    importPlaylist,
  };

  return <ChannelsContext.Provider value={providerValue}>{children}</ChannelsContext.Provider>;
};

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

// -------------------------------------------
// Interfaces
// -------------------------------------------
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
  playbackUrl?: string;
}

interface SourceApiResponse {
  category?: string;
  channels?: Channel[];
  error?: string;
}

interface SourceLoadResult {
  category: string;
  count: number;
}

const sourceErrorMessage = (error: string | undefined, status: number): string => {
  if (error === 'no_videos_found') return 'Na stránce nebyly nalezeny žádné streamy ani videa.';
  if (error === 'private_address_not_allowed') return 'Interní a lokální adresy nejsou povolené.';
  if (error === 'source_too_large') return 'Stránka je pro načtení příliš velká.';
  if (error?.startsWith('source_http_')) return `Web vrátil chybu ${error.slice('source_http_'.length)}.`;
  return `Zdroj se nepodařilo načíst (HTTP ${status}).`;
};

const isChannelsObj = (value: unknown): value is ChannelsObj => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((channels) =>
    Array.isArray(channels)
      ? channels.every(
          (channel) =>
            channel &&
            typeof channel === 'object' &&
            typeof (channel as Channel).name === 'string' &&
            typeof (channel as Channel).url === 'string' &&
            ((channel as Channel).playbackUrl === undefined || typeof (channel as Channel).playbackUrl === 'string')
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
