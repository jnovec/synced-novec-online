import { SidebarAccordionItem } from '@/components/Sidebar/SidebarAccordionItem';
import { SettingsAccordionItem } from '@/components/Sidebar/Settings/SettingsAccordionItem';
import { useChannelsContext } from '@/contexts/useChannels';
import { useControlsContext } from '@/contexts/useControls';
import { resolveChaturbateStreamUrl } from '@/lib/chaturbate';
import { ChevronLeftIcon, ChevronRightIcon, RepeatIcon } from '@chakra-ui/icons';
import { Accordion, Badge, Box, Button, Divider, Flex, Icon, IconButton, Image, Spinner, Text } from '@chakra-ui/react';
import ReactPlayer from 'react-player';
import { useEffect, useState } from 'react';

export const Sidebar = () => {
  const { channels, isRefreshing, refreshError, getAusTvChannels } = useChannelsContext();
  const { selectedVideo, setSelectedVideo } = useControlsContext();
  const [minimized, setMinimized] = useState<boolean>(false);
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const currentStreamCount = channels.Chaturbate?.length ?? 0;

  useEffect(() => {
    let cancelled = false;

    if (!selectedVideo?.url) {
      setResolvedPreviewUrl(null);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    setResolvedPreviewUrl(null);

    resolveChaturbateStreamUrl(selectedVideo.url)
      .then((streamUrl) => {
        if (cancelled) return;
        setResolvedPreviewUrl(streamUrl);
      })
      .finally(() => {
        if (cancelled) return;
        setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedVideo?.url]);

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
      <Flex justifyContent="space-between" alignItems="center" gap="2">
        {!minimized ? (
          <Box>
            <Text color="#EEEEEC" fontSize="2xl" fontWeight="bold" lineHeight="1">
              MultiScreenChaturbate
            </Text>
            <Text color="gray.400" fontSize="sm">
              Všechny veřejné streamy + preview vlevo
            </Text>
          </Box>
        ) : (
          <Text color="#EEEEEC" fontSize="lg" fontWeight="bold">
            MSC
          </Text>
        )}
        <IconButton
          size="xs"
          aria-label="minimize/maximize"
          icon={minimized ? <Icon as={ChevronRightIcon} /> : <Icon as={ChevronLeftIcon} />}
          onClick={() => setMinimized(!minimized)}
          variant="solid"
          colorScheme="red"
        />
      </Flex>

      {!minimized && (
        <Flex flexDir="column" gap="3" minH={0} flex="1" overflow="hidden">
          <Box borderWidth="1px" borderColor="whiteAlpha.200" borderRadius="lg" bg="blackAlpha.300" p="3">
            <Flex justifyContent="space-between" alignItems="center" mb="2">
              <Box minW={0}>
                <Text color="#EEEEEC" fontWeight="semibold">
                  Preview
                </Text>
                <Text color="gray.400" fontSize="sm" noOfLines={1}>
                  {selectedVideo?.name ?? 'Vyber stream vlevo pro náhled'}
                </Text>
              </Box>
              <Badge colorScheme={selectedVideo ? 'green' : 'gray'}>{selectedVideo ? 'ready' : 'empty'}</Badge>
            </Flex>

            <Box borderRadius="md" overflow="hidden" bg="black" borderWidth="1px" borderColor="whiteAlpha.200">
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
                      },
                    }}
                    style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                  />
                </Box>
              ) : (
                <Flex h="170px" alignItems="center" justifyContent="center" direction="column" gap="1" color="gray.500">
                  <Image src="/favicon.ico" alt="preview" boxSize="28px" opacity={0.6} />
                  <Text fontSize="sm">Žádný aktivní náhled</Text>
                </Flex>
              )}
            </Box>

            <Flex mt="3" justifyContent="space-between" alignItems="center" gap="2">
              <Text color="#EEEEEC" fontSize="sm" noOfLines={1} flex="1">
                {selectedVideo?.name ?? ' '}
              </Text>
              <Button size="xs" variant="outline" onClick={() => setSelectedVideo(null)} isDisabled={!selectedVideo}>
                Clear
              </Button>
            </Flex>
          </Box>

          <Divider borderColor="whiteAlpha.300" />

          <Box flex="1" minH={0} overflowY="auto" pr="1">
            <Flex alignItems="center" justifyContent="space-between" gap="2" px="1" pb="2">
              <Text color="gray.400" fontSize="xs">
                {isRefreshing ? 'Načítám aktuální streamy…' : `${currentStreamCount} aktuálních streamů`}
              </Text>
              <IconButton
                aria-label="Obnovit aktuální streamy"
                title="Refresh streamů"
                icon={<RepeatIcon />}
                size="xs"
                colorScheme="red"
                variant="outline"
                isLoading={isRefreshing}
                onClick={() => void getAusTvChannels()}
              />
            </Flex>
            {refreshError && (
              <Text color="red.300" fontSize="xs" px="1" pb="2">
                {refreshError}
              </Text>
            )}
            <Accordion allowToggle>
              {Object.keys(channels).length > 0 ? (
                <SidebarAccordionItem title="Všechny streamy" innerData={channels['Chaturbate'] ?? []} />
              ) : null}
              <SettingsAccordionItem />
            </Accordion>
          </Box>
        </Flex>
      )}

      {minimized && <Text color="gray.500">all</Text>}
    </Flex>
  );
};
