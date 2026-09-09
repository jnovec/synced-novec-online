import { Sidebar } from '@/components/Sidebar';
import { SessionUrlLoader } from '@/components/SessionUrlLoader';
import { Box, Flex } from '@chakra-ui/react';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell = ({ children }: AppShellProps) => {
  return (
    <>
      <SessionUrlLoader />
      <Flex w="100vw" h="100vh" bg="#050505" overflow="hidden">
        <Sidebar />
        <Box flex="1" minW="0" minH="0" p="3" bg="#0A0A0A">
          {children}
        </Box>
      </Flex>
    </>
  );
};
