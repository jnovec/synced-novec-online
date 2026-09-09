import { AppShell } from '@/components/AppShell';
import { PageHeadMetadata } from '@/components/PageHeadMetadata';
import { VideoGrid } from '@/components/VideoGrid';

const Home = () => {
  return (
    <>
      <PageHeadMetadata
        title="MultiScreen | webové streamy na jedné obrazovce"
        description="Načti streamy z vlastní URL a sleduj až 9 videí současně s rychlým náhledem."
      />
      <AppShell>
        <VideoGrid />
      </AppShell>
    </>
  );
};

export default Home;
