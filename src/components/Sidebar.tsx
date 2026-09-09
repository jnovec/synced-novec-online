import { SidebarAccordionItem } from '@/components/Sidebar/SidebarAccordionItem';
import { SettingsAccordionItem } from '@/components/Sidebar/Settings/SettingsAccordionItem';
import { useChannelsContext } from '@/contexts/useChannels';
import { useControlsContext } from '@/contexts/useControls';
import { resolveRemoteStreamUrl, shouldEmbedRemotePage } from '@/lib/remoteVideo';
import { AddIcon, ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { Accordion, Badge, Box, Button, Divider, Flex, Icon, IconButton, Image, Input, Spinner, Text, useToast } from '@chakra-ui/react';
import ReactPlayer from 'react-player';
import { useEffect, useState } from 'react';

const supportedSourceWebsites = ['bongacams.com', 'chaturbate.com', 'stripchat.com', 'camsoda.com'];

export const Sidebar = () => {
  const toast = useToast();
  const { channels, isLoadingSource, sourceError, loadSource } = useChannelsContext();
  const { selectedVideo, setSelectedVideo } = useControlsContext();
  const [minimized, setMinimized] = useState<boolean>(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const currentStreamCount = Object.values(channels).reduce((sum, group) => sum + group.length, 0);

  useEffect(() => {
    let cancelled = false;

    if (!selectedVideo?.url) {
      setResolvedPreviewUrl(null);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    setResolvedPreviewUrl(null);

    resolveRemoteStreamUrl(selectedVideo.url, selectedVideo.playbackUrl)
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
  }, [selectedVideo?.playbackUrl, selectedVideo?.url]);

  const handleSourceSubmit = async () => {
    if (!sourceUrl.trim()) return;
    try {
      const result = await loadSource(sourceUrl);
      toast({
        title: `${result.category}: ${result.count} položek`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      setSourceUrl('');
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
      <Flex justifyContent="space-between" alignItems="center" gap="2">
        {!minimized ? (
          <Box>
            <Text color="#EEEEEC" fontSize="2xl" fontWeight="bold" lineHeight="1">
              MultiScreenChaturbate
            </Text>
            <Text color="gray.400" fontSize="sm">
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

          <Box borderWidth="1px" borderColor="whiteAlpha.200" borderRadius="lg" bg="blackAlpha.300" p="3">
            <Text color="#EEEEEC" fontSize="sm" fontWeight="semibold" mb="2">
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
                placeholder="bongacams.com"
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
            <Text color="gray.500" fontSize="xs" mt="2">
              Nalezená videa se uloží do sekce pojmenované podle domény.
            </Text>
          </Box>

          <Divider borderColor="whiteAlpha.300" />

          <Box flex="1" minH={0} overflowY="auto" pr="1">
            <Flex alignItems="center" justifyContent="space-between" gap="2" px="1" pb="2">
              <Text color="gray.400" fontSize="xs">
                {isLoadingSource ? 'Načítám web…' : `${currentStreamCount} uložených streamů`}
              </Text>
            </Flex>
            {sourceError && (
              <Text color="red.300" fontSize="xs" px="1" pb="2">
                {sourceError}
              </Text>
            )}
            <Accordion allowToggle>
              {Object.entries(channels).map(([category, sourceChannels]) => (
                <SidebarAccordionItem key={category} title={category} innerData={sourceChannels} />
              ))}
              <SettingsAccordionItem />
            </Accordion>
          </Box>
        </Flex>
      )}

      {minimized && <Text color="gray.500">URL</Text>}
    </Flex>
  );
};
