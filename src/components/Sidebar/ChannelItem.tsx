import { useControlsContext } from '@/contexts/useControls';
import { Box, Flex, Image, Text } from '@chakra-ui/react';
import { DragEvent } from 'react';

interface ChannelItemProps {
  name: string;
  location: string;
  url: string;
  logo?: string;
}

export const ChannelItem = ({ name, location, url, logo }: ChannelItemProps) => {
  const { selectedVideo, setSelectedVideo } = useControlsContext();

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('videoUrl', url);
    e.dataTransfer.setData('videoName', name);
    return;
  };

  const handleOnClick = () => {
    return setSelectedVideo({ url, name });
  };

  return (
    <Flex
      alignItems="center"
      my="1"
      py="1"
      px="1"
      gap="2"
      borderRadius="md"
      backgroundColor={selectedVideo?.url === url ? 'gray.700' : 'blackAlpha.400'}
      _hover={{ backgroundColor: 'gray.700', cursor: 'pointer' }}
      onDragStart={handleDragStart}
      onClick={handleOnClick}
      draggable
    >
      <Box flexShrink={0} w="44px" h="32px" borderRadius="sm" overflow="hidden" bg="black">
        {logo ? <Image src={logo} alt={name} w="100%" h="100%" objectFit="cover" /> : null}
      </Box>
      <Box minW={0} flex="1">
        <Text color="#EEEEEC" fontSize="sm" fontWeight="semibold" noOfLines={1}>
          {name}
        </Text>
        <Text color="gray.400" fontSize="xs" noOfLines={1}>
          {location}
        </Text>
      </Box>
    </Flex>
  );
};
