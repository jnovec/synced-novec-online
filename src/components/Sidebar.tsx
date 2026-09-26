import { ChannelItem } from '@/components/Sidebar/ChannelItem';
import { SettingsAccordionItem } from '@/components/Sidebar/Settings/SettingsAccordionItem';
import { useChannelsContext } from '@/contexts/useChannels';
import { useControlsContext } from '@/contexts/useControls';
import { findFirstEmptyVisibleSlot } from '@/lib/slotSelection';
import { resolveRemoteStreamUrl, shouldEmbedRemotePage } from '@/lib/remoteVideo';
import { AddIcon, ChevronLeftIcon, ChevronRightIcon, RepeatIcon } from '@chakra-ui/icons';
import { Accordion, Badge, Box, Button, Divider, Flex, Icon, IconButton, Image, Input, Select, Spinner, Text, useToast } from '@chakra-ui/react';
import { DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import ReactPlayer from 'react-player';

const supportedSourceWebsites = ['bongacams.com', 'chaturbate.com', 'stripchat.com', 'camsoda.com', 'cam4.com', 'myfreecams.com', 'youtube.com'];
const SLOT_DRAG_TYPE = 'application/x-synced-slot-index';
const defaultChaturbateTags = ['18', 'young'];
const STREAM_RESOLVE_ATTEMPTS = 3;
const CHATURBATE_EMBED_LISTING_URL = 'https://chaturbate.com/in/?tour=x1Rd&campaign=6wVVW&track=default&c=15&p=1&gender=x';

const waitForRetry = (attempt: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, 700 * attempt);
});

interface MoreRoomCardProps {
  name: string;
  location: string;
  url: string;
  logo?: string;
  playbackUrl?: string;
  selected: boolean;
  onSelect: () => void;
}

const MoreRoomCard = ({ name, location, url, logo, playbackUrl, selected, onSelect }: MoreRoomCardProps) => {
  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('videoUrl', url);
    event.dataTransfer.setData('videoName', name);
    event.dataTransfer.setData('text/uri-list', url);
    event.dataTransfer.setData('text/plain', url);
    if (playbackUrl) event.dataTransfer.setData('videoPlaybackUrl', playbackUrl);
  };

  return (
    <Box
      draggable
      onDragStart={handleDragStart}
      onClick={onSelect}
      cursor="grab"
      overflow="hidden"
      borderWidth="1px"
      borderColor={selected ? 'purple.300' : 'whiteAlpha.200'}
      borderRadius="md"
      bg="blackAlpha.500"
      _hover={{ borderColor: 'purple.200', transform: 'translateY(-1px)' }}
      transition="all 120ms ease"
    >
      <Box h="76px" bg="black" position="relative" overflow="hidden">
        {playbackUrl ? (
          <ReactPlayer
            url={playbackUrl}
            playing
            muted
            loop
            width="100%"
            height="100%"
            playsinline
            config={{ file: { forceHLS: true } }}
            style={{ objectFit: 'cover', pointerEvents: 'none' }}
          />
        ) : logo ? (
          <Image src={logo} alt={name} w="100%" h="100%" objectFit="cover" />
        ) : null}
        <Badge position="absolute" left="1" bottom="1" colorScheme="blackAlpha" fontSize="9px">LIVE</Badge>
      </Box>
      <Box px="2" py="1">
        <Text color="#EEEEEC" fontSize="xs" fontWeight="semibold" noOfLines={1}>{name}</Text>
        <Text color="gray.400" fontSize="10px" noOfLines={1}>{location}</Text>
      </Box>
    </Box>
  );
};

export const Sidebar = () => {
  const toast = useToast();
  const { channels, isLoadingSource, sourceError, loadSource, saveChannelToPlaylist } = useChannelsContext();
  const { selectedVideo, setSelectedVideo, slots, gridSize, setSlotVideo } = useControlsContext();
  const [minimized, setMinimized] = useState<boolean>(false);
  const [sidebarMode, setSidebarMode] = useState<'sources' | 'settings'>('sources');
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0);
  const [isMoreRoomsOpen, setIsMoreRoomsOpen] = useState(false);
  const [moreRoomsPage, setMoreRoomsPage] = useState(0);
  const [moreRoomsPosition, setMoreRoomsPosition] = useState(0);
  const [sourceUrl, setSourceUrl] = useState('');
  const [chaturbateTag, setChaturbateTag] = useState('18');
  const [chaturbateTags, setChaturbateTags] = useState(defaultChaturbateTags);
  const [isLoadingChaturbateTags, setIsLoadingChaturbateTags] = useState(false);
  const [isChaturbateEmbedOpen, setIsChaturbateEmbedOpen] = useState(false);
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [isPreviewDropActive, setIsPreviewDropActive] = useState(false);
  const previewPlaybackFailures = useRef(0);
  const lastPreviewProgress = useRef(0);
  const currentStreamCount = Object.values(channels).reduce((sum, group) => sum + group.length, 0);
  const previewCandidates = Object.values(channels).flat();
  const sourceCategories = useMemo(() => Object.entries(channels), [channels]);
  const moreRoomsItems = sourceCategories[selectedCategoryIndex]?.[1] ?? [];
  const moreRoomsPageSize = 12;
  const moreRoomsPageCount = Math.max(1, Math.ceil(moreRoomsItems.length / moreRoomsPageSize));
  const visibleMoreRooms = moreRoomsItems.slice(moreRoomsPage * moreRoomsPageSize, (moreRoomsPage + 1) * moreRoomsPageSize);
  const moreRoomsPositionStyles = [
    { left: '16px', bottom: '16px' },
    { right: '16px', bottom: '16px' },
    { right: '16px', top: '16px' },
    { left: '16px', top: '16px' },
  ][moreRoomsPosition];

  useEffect(() => {
    setMoreRoomsPage(0);
  }, [selectedCategoryIndex]);
  const isChaturbateSource = /(?:^|\/\/)(?:www\.)?chaturbate\.com(?:\/|$)/i.test(sourceUrl.trim());
  const movePreview = (direction: -1 | 1) => {
    if (!previewCandidates.length) return;
    const index = previewCandidates.findIndex((item) => item.url === selectedVideo?.url);
    const next = (index + direction + previewCandidates.length) % previewCandidates.length;
    setSelectedVideo(previewCandidates[next]);
  };
  const randomizePreview = () => {
    if (!previewCandidates.length) return;
    const alternatives = previewCandidates.filter((item) => item.url !== selectedVideo?.url);
    const choices = alternatives.length ? alternatives : previewCandidates;
    setSelectedVideo(choices[Math.floor(Math.random() * choices.length)]);
  };
  const addPreviewToGrid = () => {
    if (!selectedVideo) return;
    const emptySlot = findFirstEmptyVisibleSlot(slots, gridSize);
    if (emptySlot < 0) {
      toast({ title: 'Všechna viditelná okna jsou obsazená', description: 'Zvětši mřížku nebo uvolni některé okno.', status: 'info', duration: 2600 });
      return;
    }
    setSlotVideo(emptySlot, selectedVideo);
    toast({ title: `Preview přidáno do okna ${emptySlot + 1}`, status: 'success', duration: 1600 });
  };
  const handlePreviewDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    addPreviewToGrid();
  };

  const refreshPreview = () => {
    previewPlaybackFailures.current = 0;
    setPreviewReloadKey((current) => current + 1);
  };

  const handlePreviewPlayerError = () => {
    previewPlaybackFailures.current += 1;
    setPreviewReloadKey((current) => current + 1);
  };

  const handlePreviewProgress = () => {
    lastPreviewProgress.current = Date.now();
    previewPlaybackFailures.current = 0;
  };

  useEffect(() => {
    previewPlaybackFailures.current = 0;
    lastPreviewProgress.current = Date.now();
  }, [selectedVideo?.playbackUrl, selectedVideo?.url]);

  useEffect(() => {
    if (!selectedVideo?.url) return;
    let cancelled = false;
    const scrollToSelectedChannel = () => {
      if (cancelled) return;
      const selectedItem = Array.from(document.querySelectorAll<HTMLElement>('[data-channel-url]')).find(
        (element) => element.dataset.channelUrl === selectedVideo.url
      );
      if (!selectedItem) return;
      const accordionItem = selectedItem.closest<HTMLElement>('[data-index]');
      const expandButton = accordionItem?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      expandButton?.click();
      // Keep the selected stream near the second visible row while the
      // expanded category header remains in the same scroll context.
      selectedItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const frame = window.requestAnimationFrame(scrollToSelectedChannel);
    const retry = window.setTimeout(scrollToSelectedChannel, 180);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
    };
  }, [selectedVideo?.url]);

  useEffect(() => {
    if (!selectedVideo?.url) return;
    const categoryIndex = sourceCategories.findIndex(([, items]) => items.some((item) => item.url === selectedVideo.url));
    if (categoryIndex >= 0) setSelectedCategoryIndex(categoryIndex);
  }, [selectedVideo?.url, sourceCategories]);

  useEffect(() => {
    if (!resolvedPreviewUrl) return;

    lastPreviewProgress.current = Date.now();
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastPreviewProgress.current < 12_000) return;
      setPreviewReloadKey((current) => current + 1);
      lastPreviewProgress.current = Date.now();
    }, 4_000);

    return () => window.clearInterval(watchdog);
  }, [resolvedPreviewUrl]);

  useEffect(() => {
    if (!isChaturbateSource) return;

    let cancelled = false;
    setIsLoadingChaturbateTags(true);

    fetch('/api/chaturbate-tags', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('tag_fetch_failed');
        return response.json() as Promise<{ tags?: unknown }>;
      })
      .then((data) => {
        if (cancelled || !Array.isArray(data.tags)) return;
        const tags = data.tags.filter((tag): tag is string => typeof tag === 'string');
        if (tags.length) setChaturbateTags((current) => Array.from(new Set([...defaultChaturbateTags, ...current, ...tags])).sort());
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoadingChaturbateTags(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isChaturbateSource, sourceUrl]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedVideo?.url) {
      setResolvedPreviewUrl(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    setPreviewLoading(true);
    setResolvedPreviewUrl(null);
    setPreviewError(null);

    const resolvePreview = async () => {
      for (let attempt = 1; attempt <= STREAM_RESOLVE_ATTEMPTS; attempt += 1) {
        try {
          const streamUrl = await resolveRemoteStreamUrl(selectedVideo.url, selectedVideo.playbackUrl);
          if (cancelled) return;
          if (streamUrl || shouldEmbedRemotePage(selectedVideo.url)) {
            setResolvedPreviewUrl(streamUrl);
            setPreviewLoading(false);
            return;
          }
        } catch {
          // A short-lived upstream URL can fail once while a model changes stream edge.
        }

        if (attempt < STREAM_RESOLVE_ATTEMPTS) await waitForRetry(attempt);
      }

      if (!cancelled) {
        setPreviewLoading(false);
        setPreviewError('Stream se nepodařilo načíst. Zkus ho obnovit.');
      }
    };

    void resolvePreview();

    return () => {
      cancelled = true;
    };
  }, [previewReloadKey, selectedVideo?.playbackUrl, selectedVideo?.url]);

  const handlePreviewDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes(SLOT_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsPreviewDropActive(true);
  };

  const handlePreviewDragLeave = () => {
    setIsPreviewDropActive(false);
  };

  const handlePreviewDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!selectedVideo?.url) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('videoUrl', selectedVideo.url);
    event.dataTransfer.setData('videoName', selectedVideo.name);
    event.dataTransfer.setData('text/uri-list', selectedVideo.url);
    event.dataTransfer.setData('text/plain', selectedVideo.url);
    if (selectedVideo.playbackUrl) event.dataTransfer.setData('videoPlaybackUrl', selectedVideo.playbackUrl);
  };

  const handlePreviewDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsPreviewDropActive(false);

    const rawIndex = event.dataTransfer.getData(SLOT_DRAG_TYPE);
    const index = Number.parseInt(rawIndex, 10);
    if (!Number.isInteger(index) || index < 0 || index >= slots.length) return;

    const slot = slots[index];
    if (!slot?.url) return;

    setSelectedVideo({
      name: slot.name,
      url: slot.url,
      ...(slot.playbackUrl ? { playbackUrl: slot.playbackUrl } : {}),
    });

    toast({
      title: 'Stream přenesen do Preview',
      description: slot.name,
      status: 'success',
      duration: 1600,
      isClosable: false,
    });
  };

  const handleSavePreview = () => {
    if (!selectedVideo?.url) return;
    const category = saveChannelToPlaylist(selectedVideo);
    toast({
      title: 'Uloženo do playlistu',
      description: `${selectedVideo.name} → ${category}`,
      status: 'success',
      duration: 2200,
      isClosable: true,
    });
  };

  const handleSourceSubmit = async () => {
    if (!sourceUrl.trim()) return;
    try {
      const result = await loadSource(sourceUrl, isChaturbateSource ? chaturbateTag : '');
      if (result.tags.length) {
        setChaturbateTags((current) => Array.from(new Set([...defaultChaturbateTags, ...current, ...result.tags])).sort());
      }
      toast({
        title: `${result.category}: ${result.count} položek`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      if (!isChaturbateSource) setSourceUrl('');
    } catch (error) {
      toast({
        title: 'Zdroj se nepodařilo načíst',
        description: error instanceof Error ? error.message : 'Neznámá chyba',
        status: 'error',
        duration: 4500,
        isClosable: true,
      });
    }
  };

  return (
    <Flex
      flexDir="column"
      alignItems="stretch"
      p="3"
      w={minimized ? '56px' : '360px'}
      minW={minimized ? '56px' : '320px'}
      maxW={minimized ? '56px' : '420px'}
      height="full"
      bg="#090C02"
      gap="3"
      transition="width 0.25s ease"
      overflow="hidden"
    >
      <Flex position="relative" justifyContent="center" alignItems="center" minH="118px">
        {!minimized ? (
          <Box textAlign="center">
            <Image
              src="/synced-logo-cropped.png"
              alt="SYNCED"
              h="76px"
              w="auto"
              maxW="310px"
              objectFit="contain"
              objectPosition="center"
              mx="auto"
            />
            <Text color="gray.400" fontSize="sm" mt="1">
              Vlastní webové zdroje + preview
            </Text>
          </Box>
        ) : (
          <Text color="#EEEEEC" fontSize="lg" fontWeight="bold">
            MSC
          </Text>
        )}
        <IconButton
          size="xs"
          position="absolute"
          right="0"
          top="0"
          aria-label="minimize/maximize"
          icon={minimized ? <Icon as={ChevronRightIcon} /> : <Icon as={ChevronLeftIcon} />}
          onClick={() => setMinimized(!minimized)}
          variant="solid"
          colorScheme="red"
        />
      </Flex>

      {!minimized && (
        <Flex flexDir="column" gap="3" minH={0} flex="1" overflow="hidden">
          <Flex gap="2" borderBottomWidth="1px" borderColor="whiteAlpha.300" pb="2">
            <Button size="sm" flex="1" colorScheme={sidebarMode === 'sources' ? 'blue' : 'gray'} onClick={() => setSidebarMode('sources')}>
              Zdroje
            </Button>
            <Button size="sm" flex="1" colorScheme={sidebarMode === 'settings' ? 'purple' : 'gray'} onClick={() => setSidebarMode('settings')}>
              Settings
            </Button>
          </Flex>
          {sidebarMode === 'settings' ? (
            <Box flex="1" minH={0} overflowY="auto" pr="1" borderWidth="1px" borderColor="whiteAlpha.200" borderRadius="lg" bg="blackAlpha.300" p="3">
              <Accordion allowToggle defaultIndex={0}>
                <SettingsAccordionItem />
              </Accordion>
            </Box>
          ) : (
            <Flex flexDir="column" gap="1" minH={0} flex="1" overflow="hidden">
          <Box order={2} borderWidth="1px" borderColor={isPreviewDropActive ? 'cyan.300' : 'whiteAlpha.200'} borderRadius="lg" bg="blackAlpha.300" p="3">
            <Flex justifyContent="space-between" alignItems="center" mb="2">
              <Box minW={0}>
                <Text color="#EEEEEE" fontWeight="semibold">
                  Preview
                </Text>
                <Text color="gray.400" fontSize="sm" noOfLines={1}>
                  {selectedVideo?.name ?? 'Vyber stream vlevo pro náhled'}
                </Text>
              </Box>
              <Flex alignItems="center" gap="1">
                <Badge colorScheme={selectedVideo && !previewError ? 'green' : 'gray'}>{selectedVideo && !previewError ? 'ready' : 'empty'}</Badge>
                <IconButton
                  aria-label="Obnovit náhled streamu"
                  icon={<RepeatIcon />}
                  size="xs"
                  variant="ghost"
                  color="gray.300"
                  onClick={refreshPreview}
                  isDisabled={!selectedVideo || previewLoading}
                />
              </Flex>
            </Flex>

            <Box
              borderRadius="md"
              overflow="hidden"
              bg="black"
              borderWidth="2px"
              borderColor={isPreviewDropActive ? 'cyan.300' : 'whiteAlpha.200'}
              boxShadow={isPreviewDropActive ? '0 0 0 2px rgba(34,211,238,.35), 0 0 24px rgba(34,211,238,.25)' : undefined}
              position="relative"
              draggable={Boolean(selectedVideo)}
              cursor={selectedVideo ? 'grab' : 'default'}
              onDragStart={handlePreviewDragStart}
              onDoubleClick={handlePreviewDoubleClick}
              onDragEnter={handlePreviewDragOver}
              onDragOver={handlePreviewDragOver}
              onDragLeave={handlePreviewDragLeave}
              onDrop={handlePreviewDrop}
            >
              {previewLoading ? (
                <Flex h="170px" alignItems="center" justifyContent="center" direction="column" gap="2" color="gray.400">
                  <Spinner size="sm" />
                  <Text fontSize="sm">Načítám stream…</Text>
                </Flex>
              ) : resolvedPreviewUrl ? (
                <Box h="170px" position="relative">
                  <ReactPlayer
                    width="100%"
                    height="100%"
                    url={resolvedPreviewUrl}
                    playing
                    muted
                    volume={0}
                    config={{
                      file: {
                        forceHLS: true,
                        attributes: {
                          crossOrigin: 'true',
                        },
                        hlsOptions: {
                          lowLatencyMode: false,
                          liveSyncDurationCount: 3,
                          liveMaxLatencyDurationCount: 10,
                          manifestLoadingMaxRetry: 4,
                          levelLoadingMaxRetry: 4,
                          fragLoadingMaxRetry: 6,
                          fragLoadingRetryDelay: 800,
                        },
                      },
                    }}
                    onError={handlePreviewPlayerError}
                    onProgress={handlePreviewProgress}
                    style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                  />
                  {isPreviewDropActive && (
                    <Flex position="absolute" inset={0} alignItems="center" justifyContent="center" bg="blackAlpha.700" pointerEvents="none">
                      <Badge colorScheme="cyan" fontSize="sm" px="3" py="2">
                        Pusť stream sem
                      </Badge>
                    </Flex>
                  )}
                </Box>
              ) : selectedVideo && shouldEmbedRemotePage(selectedVideo.url) ? (
                <Box
                  as="iframe"
                  title={`Náhled ${selectedVideo.name}`}
                  src={selectedVideo.url}
                  h="170px"
                  w="100%"
                  border="0"
                  sandbox="allow-scripts allow-forms allow-popups allow-presentation"
                  referrerPolicy="no-referrer"
                  pointerEvents="none"
                />
              ) : previewError ? (
                <Flex h="170px" alignItems="center" justifyContent="center" direction="column" gap="3" color="gray.300" px="4" textAlign="center">
                  <Text fontSize="sm">{previewError}</Text>
                  <Button size="sm" leftIcon={<RepeatIcon />} onClick={refreshPreview}>
                    Obnovit stream
                  </Button>
                </Flex>
              ) : (
                <Flex h="170px" alignItems="center" justifyContent="center" direction="column" gap="1" color={isPreviewDropActive ? 'cyan.200' : 'gray.500'}>
                  <Image src="/favicon.ico" alt="preview" boxSize="28px" opacity={0.6} />
                  <Text fontSize="sm">{isPreviewDropActive ? 'Pusť stream sem' : 'Žádný aktivní náhled'}</Text>
                </Flex>
              )}
              <Flex position="absolute" bottom="2" left="0" right="0" justifyContent="space-between" px="2" pointerEvents="none">
                <IconButton aria-label="Předchozí stream v Preview" icon={<ChevronLeftIcon />} size="sm" colorScheme="blackAlpha" onClick={() => movePreview(-1)} isDisabled={!previewCandidates.length} pointerEvents="auto" />
                <Button size="xs" colorScheme="purple" onClick={randomizePreview} isDisabled={!previewCandidates.length} pointerEvents="auto" aria-label="Náhodný načtený stream">
                  🎲 Náhodně
                </Button>
                <IconButton aria-label="Další stream v Preview" icon={<ChevronRightIcon />} size="sm" colorScheme="blackAlpha" onClick={() => movePreview(1)} isDisabled={!previewCandidates.length} pointerEvents="auto" />
              </Flex>
            </Box>

            <Flex mt="3" justifyContent="space-between" alignItems="center" gap="2">
              <Text color="#EEEEEC" fontSize="sm" noOfLines={1} flex="1">
                {selectedVideo?.name ?? ' '}
              </Text>
              <Flex gap="2">
                <Button size="xs" colorScheme="blue" onClick={addPreviewToGrid} isDisabled={!selectedVideo}>
                  Přidat do okna
                </Button>
                <Button size="xs" colorScheme="green" onClick={handleSavePreview} isDisabled={!selectedVideo}>
                  Uložit do playlistu
                </Button>
                <Button size="xs" variant="outline" onClick={() => setSelectedVideo(null)} isDisabled={!selectedVideo}>
                  Clear
                </Button>
              </Flex>
            </Flex>
          </Box>

          <Box order={1} borderWidth="1px" borderColor="whiteAlpha.200" borderRadius="lg" bg="blackAlpha.300" p="3">
            <Text color="#EEEEEE" fontSize="sm" fontWeight="semibold" mb="2">
              Přidat webový zdroj
            </Text>
            <Flex gap="2">
              <Input
                size="sm"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSourceSubmit();
                }}
                placeholder={selectedVideo?.url ?? 'https://example.com nebo bongacams.com'}
                color="#EEEEEC"
                _placeholder={{ color: 'whiteAlpha.600' }}
                bg="black"
                borderColor="whiteAlpha.400"
                list="supported-source-websites"
                aria-label="URL webu se streamy"
              />
              <datalist id="supported-source-websites">
                {supportedSourceWebsites.map((website) => (
                  <option key={website} value={website} />
                ))}
              </datalist>
              <IconButton
                aria-label="Načíst webový zdroj"
                icon={<AddIcon />}
                size="sm"
                colorScheme="red"
                isLoading={isLoadingSource}
                isDisabled={!sourceUrl.trim()}
                onClick={() => void handleSourceSubmit()}
              />
            </Flex>
            {isChaturbateSource && (
              <>
                <Flex mt="2" gap="2" alignItems="center">
                  <Text color="gray.300" fontSize="xs" whiteSpace="nowrap">Tag</Text>
                  <Select
                    size="xs"
                    value={chaturbateTag}
                    onChange={(event) => setChaturbateTag(event.target.value)}
                    bg="black"
                    borderColor="whiteAlpha.400"
                    color="#EEEEEC"
                    aria-label="Chaturbate tag"
                  >
                    {chaturbateTags.map((tag) => (
                      <option key={tag} value={tag}>#{tag}</option>
                    ))}
                  </Select>
                  <Button size="xs" colorScheme="pink" onClick={() => void handleSourceSubmit()} isLoading={isLoadingSource || isLoadingChaturbateTags}>
                    Načíst tag
                  </Button>
                </Flex>
                <Button mt="2" size="xs" variant="outline" colorScheme="purple" onClick={() => setIsChaturbateEmbedOpen((open) => !open)}>
                  {isChaturbateEmbedOpen ? 'Skrýt embedded seznam' : 'Zobrazit embedded seznam'}
                </Button>
                {isChaturbateEmbedOpen && (
                  <Flex mt="2" minH="180px" p="4" borderWidth="1px" borderColor="whiteAlpha.300" borderRadius="md" bg="blackAlpha.400" direction="column" justifyContent="center" alignItems="center" gap="3" textAlign="center">
                    <Text color="gray.300" fontSize="sm">
                      Chaturbate tento affiliate seznam technicky blokuje pro vložení do iframe.
                    </Text>
                    <Button as="a" href={CHATURBATE_EMBED_LISTING_URL} target="_blank" rel="noreferrer" size="sm" colorScheme="purple">
                      Otevřít seznam na Chaturbate
                    </Button>
                    <Text color="gray.500" fontSize="xs">
                      Streamy do gridu dál přidáš z načtených tagů níže.
                    </Text>
                  </Flex>
                )}
              </>
            )}
            <Box color="gray.400" fontSize="xs" mt="2">
              <Flex gap="1" flexWrap="wrap" alignItems="center">
                <Text as="span">Podporované weby:</Text>
                {supportedSourceWebsites.map((website) => (
                  <Button key={website} size="xs" variant="link" color="blue.200" onClick={() => setSourceUrl(website)}>{website}</Button>
                ))}
              </Flex>
            </Box>
          </Box>

          <Divider order={3} borderColor="whiteAlpha.300" />

          <Flex order={4} position="relative" flex="1" minH={0} direction="column" overflow="hidden">
            {sourceError && (
              <Text color="red.300" fontSize="xs" px="1" pb="2">
                {sourceError}
              </Text>
            )}
            <Box borderWidth="1px" borderColor="whiteAlpha.200" borderRadius="lg" bg="blackAlpha.300" p="2" mb="0">
              <Flex gap="2">
                <Select
                  size="sm"
                  value={selectedCategoryIndex}
                  onChange={(event) => setSelectedCategoryIndex(Number(event.target.value))}
                  bg="purple.500"
                  color="white"
                  borderColor="purple.300"
                  _hover={{ bg: 'purple.600' }}
                  sx={{ option: { color: '#1A202C', background: 'white' } }}
                  aria-label="Vybraná kategorie streamů"
                >
                  {sourceCategories.map(([category, sourceChannels], categoryIndex) => (
                    <option key={category} value={categoryIndex}>{category} ({sourceChannels.length})</option>
                  ))}
                </Select>
                <Button size="sm" colorScheme="purple" onClick={() => setIsMoreRoomsOpen((open) => !open)}>
                  {isMoreRoomsOpen ? 'Skrýt' : 'More Rooms'}
                </Button>
              </Flex>
            </Box>
            {isMoreRoomsOpen && <Box
              position="fixed"
              {...moreRoomsPositionStyles}
              w="340px"
              zIndex={30}
              maxH="360px"
              minH="120px"
              overflowY="auto"
              overscrollBehavior="contain"
              borderWidth="1px"
              borderColor="purple.300"
              borderRadius="lg"
              bg="#111807"
              p="2"
              boxShadow="0 12px 28px rgba(0,0,0,.65)"
            >
              <Flex
                position="sticky"
                top="-2"
                zIndex={1}
                alignItems="center"
                justifyContent="space-between"
                mb="2"
                py="1"
                bg="blackAlpha.800"
              >
                <Text color="gray.300" fontSize="xs" fontWeight="semibold">More Rooms</Text>
                <Text color="gray.500" fontSize="10px">Přetáhni do okna</Text>
              </Flex>
              <Box display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap="2">
                {visibleMoreRooms.map((channel) => (
                  <MoreRoomCard
                    key={`more-room-${channel.url}`}
                    {...channel}
                    selected={selectedVideo?.url === channel.url}
                    onSelect={() => setSelectedVideo({ url: channel.url, name: channel.name, ...(channel.playbackUrl ? { playbackUrl: channel.playbackUrl } : {}) })}
                  />
                ))}
              </Box>
              <Flex alignItems="center" justifyContent="space-between" mt="2" pt="2" borderTopWidth="1px" borderColor="whiteAlpha.200">
                <IconButton
                  aria-label="Předchozí stránka More Rooms"
                  icon={<ChevronLeftIcon />}
                  size="xs"
                  variant="ghost"
                  color="gray.300"
                  onClick={() => setMoreRoomsPage((page) => (page - 1 + moreRoomsPageCount) % moreRoomsPageCount)}
                  isDisabled={moreRoomsPageCount <= 1}
                />
                <Text color="gray.500" fontSize="10px">{moreRoomsPage + 1} / {moreRoomsPageCount}</Text>
                <Flex gap="1">
                  <IconButton
                    aria-label="Další stránka More Rooms"
                    icon={<ChevronRightIcon />}
                    size="xs"
                    variant="ghost"
                    color="gray.300"
                    onClick={() => setMoreRoomsPage((page) => (page + 1) % moreRoomsPageCount)}
                    isDisabled={moreRoomsPageCount <= 1}
                  />
                  <IconButton
                    aria-label="Přesunout panel More Rooms"
                    icon={<ChevronRightIcon />}
                    size="xs"
                    colorScheme="purple"
                    onClick={() => setMoreRoomsPosition((position) => (position + 1) % 4)}
                  />
                </Flex>
              </Flex>
            </Box>}
            <Box flex="1" minH={0} overflowY="auto" pr="1">
              {sourceCategories[selectedCategoryIndex]?.[1].map((channel) => (
                <ChannelItem key={channel.url} {...channel} />
              ))}
            </Box>
          </Flex>
            </Flex>
          )}
        </Flex>
      )}

      {minimized && <Text color="gray.500">URL</Text>}
    </Flex>
  );
};
