import { useChannelsContext } from '@/contexts/useChannels';
import { useControlsContext } from '@/contexts/useControls';
import { isDisplaySlot } from '@/lib/displayMedia';
import { buildM3uPlaylist } from '@/lib/playlist';
import { resolveRemoteStreamUrl } from '@/lib/remoteVideo';
import { AddIcon, MinusIcon } from '@chakra-ui/icons';
import {
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  Divider,
  Flex,
  IconButton,
  Input,
  Text,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { AddCategoryModal } from './AddCategoryModal';
import { AddChannelModal } from './AddChannelModal';
import { DeleteCategoryModal } from './DeleteCategoryModal';
import { DeleteChannelModal } from './DeleteChannelModal';
import { GamepadSettings } from './GamepadSettings';
import { SessionSettings } from './SessionSettings';

export const SettingsAccordionItem = () => {
  const { isOpen: isOpenAddCategory, onOpen: onOpenAddCategory, onClose: onCloseAddCategory } = useDisclosure();
  const {
    isOpen: isOpenDeleteCategory,
    onOpen: onOpenDeleteCategory,
    onClose: onCloseDeleteCategory,
  } = useDisclosure();
  const { isOpen: isOpenAddChannel, onOpen: onOpenAddChannel, onClose: onCloseAddChannel } = useDisclosure();
  const { isOpen: isOpenDeleteChannel, onOpen: onOpenDeleteChannel, onClose: onCloseDeleteChannel } = useDisclosure();
  const toast = useToast();
  const { clearChannels, importPlaylist } = useChannelsContext();
  const { gridSize, setGridSize, gridSizeMap, slots } = useControlsContext();
  const possibleGridSizes = Object.keys(gridSizeMap)
    .map((key) => parseInt(key, 10))
    .filter((size) => size <= 18);
  const [gridSizeIndex, setGridSizeIndex] = useState<number>(possibleGridSizes.findIndex((size) => size === gridSize));
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [isImportingPlaylist, setIsImportingPlaylist] = useState(false);
  const [isExportingPlaylist, setIsExportingPlaylist] = useState(false);

  // Update grid size index when grid size changes
  useEffect(() => {
    const nextIndex = possibleGridSizes.findIndex((size) => size === gridSize);
    if (nextIndex === -1) {
      setGridSize(9);
      return;
    }
    setGridSizeIndex(nextIndex);
  }, [gridSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGridSizeDecreaseClick = () => {
    // Get new index
    const newIndex = gridSizeIndex - 1;

    // Set the grid size to the new grid size
    return setGridSize(possibleGridSizes[newIndex]);
  };

  const handleGridSizeIncreaseClick = () => {
    // Get new index
    const newIndex = gridSizeIndex + 1;

    // Set the grid size to the new grid size
    return setGridSize(possibleGridSizes[newIndex]);
  };

  const handlePlaylistImport = async () => {
    if (!playlistUrl.trim()) return;
    setIsImportingPlaylist(true);
    try {
      const count = await importPlaylist(playlistUrl);
      toast({
        title: count ? `Přidáno ${count} streamů` : 'Playlist neobsahuje Chaturbate odkazy',
        status: count ? 'success' : 'info',
        duration: 3000,
        isClosable: true,
      });
      if (count) setPlaylistUrl('');
    } catch (error) {
      toast({
        title: 'Playlist se nepodařilo načíst',
        description: error instanceof Error ? error.message : 'Neznámá chyba',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setIsImportingPlaylist(false);
    }
  };

  const handlePlaylistExport = async () => {
    const loadedSlots = slots.filter(
      (slot): slot is NonNullable<typeof slot> => slot !== null && !isDisplaySlot(slot) && Boolean(slot.url)
    );
    if (!loadedSlots.length) {
      toast({ title: 'Není co uložit', description: 'Nejdřív načti alespoň jeden stream do gridu.', status: 'info', duration: 2800, isClosable: true });
      return;
    }

    setIsExportingPlaylist(true);
    try {
      const resolved = await Promise.all(
        loadedSlots.map(async (slot) => ({
          name: slot.name,
          streamUrl: await resolveRemoteStreamUrl(slot.url, slot.playbackUrl),
        }))
      );
      const entries = resolved.flatMap((entry) => (entry.streamUrl ? [{ name: entry.name, streamUrl: entry.streamUrl }] : []));
      if (!entries.length) throw new Error('Žádný načtený stream nyní neposkytuje M3U8 adresu.');

      const content = buildM3uPlaylist(entries);
      const objectUrl = URL.createObjectURL(new Blob([content], { type: 'application/vnd.apple.mpegurl' }));
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'multiscreenchaturbate-playlist.m3u';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast({
        title: `Playlist uložen (${entries.length} M3U8 streamů)`,
        description: entries.length < loadedSlots.length ? `${loadedSlots.length - entries.length} nedostupných streamů bylo přeskočeno.` : undefined,
        status: 'success',
        duration: 3500,
        isClosable: true,
      });
    } catch (error) {
      toast({
        title: 'Playlist se nepodařilo uložit',
        description: error instanceof Error ? error.message : 'Neznámá chyba',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setIsExportingPlaylist(false);
    }
  };

  return (
    <>
      <AccordionItem>
        <AccordionButton>
          <Box as="span" flex="1" textAlign="left" fontWeight="bold" color="#EEEEEC">
            Settings
          </Box>
          <AccordionIcon color="#EEEEEC" />
        </AccordionButton>
        <AccordionPanel pb={4} color="#EEEEEC">
          <Flex flexDir="column" w="full" gap="2">
            <Flex flexDir="column" justifyContent="center" alignItems="center" gap="1" py="1">
              <Text fontSize="sm" fontWeight="semibold">
                Počet obrazovek
              </Text>
              <Flex justifyContent="space-between" alignItems="center" w="full" gap="1">
                <IconButton
                  aria-label="Decrease"
                  icon={<MinusIcon />}
                  size="xs"
                  colorScheme="whiteAlpha"
                  variant="ghost"
                  color="#EEEEEC"
                  isDisabled={gridSizeIndex - 1 < 0}
                  onClick={handleGridSizeDecreaseClick}
                />
                <Text color="#EEEEEC">{gridSize}</Text>
                <IconButton
                  aria-label="Increase"
                  icon={<AddIcon />}
                  size="xs"
                  colorScheme="whiteAlpha"
                  variant="ghost"
                  color="#EEEEEC"
                  isDisabled={gridSizeIndex + 1 > possibleGridSizes.length - 1}
                  onClick={handleGridSizeIncreaseClick}
                />
              </Flex>
            </Flex>
            <Divider color="#EEEEEC" />
            <GamepadSettings />
            <Divider color="#EEEEEC" />
            <SessionSettings />
            <Divider color="#EEEEEC" />
            <Flex flexDir="column" justifyContent="center" alignItems="center" gap="1" py="1">
              <Text fontSize="sm" fontWeight="semibold">
                Saved Channels
              </Text>
              <Button size="xs" onClick={onOpenAddCategory} colorScheme="whiteAlpha" variant="solid" color="#EEEEEC">
                Add Category
              </Button>
              <Button size="xs" onClick={onOpenDeleteCategory} colorScheme="whiteAlpha" variant="solid" color="#EEEEEC">
                Delete Category
              </Button>
              <Button size="xs" onClick={onOpenAddChannel} colorScheme="whiteAlpha" variant="solid" color="#EEEEEC">
                Add Channel
              </Button>
              <Button size="xs" onClick={onOpenDeleteChannel} colorScheme="whiteAlpha" variant="solid" color="#EEEEEC">
                Delete Channel
              </Button>
              <Button size="xs" onClick={clearChannels} colorScheme="whiteAlpha" variant="solid" color="#EEEEEC">
                Clear Channels
              </Button>
            </Flex>
            <Divider color="#EEEEEC" />
            <Flex flexDir="column" justifyContent="center" alignItems="stretch" gap="2" py="1">
              <Text fontSize="sm" fontWeight="semibold" textAlign="center">
                Playlist URL
              </Text>
              <Input
                size="sm"
                value={playlistUrl}
                onChange={(event) => setPlaylistUrl(event.target.value)}
                placeholder="https://example.com/chaturbate-playlist.m3u"
                backgroundColor="black"
                borderColor="whiteAlpha.400"
              />
              <Text fontSize="xs" color="gray.400">
                M3U nebo textový soubor s odkazy chaturbate.com/jmeno
              </Text>
              <Button size="xs" onClick={handlePlaylistImport} isLoading={isImportingPlaylist} isDisabled={!playlistUrl.trim()} colorScheme="red">
                Načíst playlist
              </Button>
              <Button size="xs" onClick={() => void handlePlaylistExport()} isLoading={isExportingPlaylist} loadingText="Získávám M3U8…" variant="outline" colorScheme="whiteAlpha">
                Uložit jména + M3U8
              </Button>
            </Flex>
          </Flex>
        </AccordionPanel>
      </AccordionItem>
      <AddCategoryModal isOpen={isOpenAddCategory} onClose={onCloseAddCategory} />
      <DeleteCategoryModal isOpen={isOpenDeleteCategory} onClose={onCloseDeleteCategory} />
      <AddChannelModal isOpen={isOpenAddChannel} onClose={onCloseAddChannel} />
      <DeleteChannelModal isOpen={isOpenDeleteChannel} onClose={onCloseDeleteChannel} />
    </>
  );
};
