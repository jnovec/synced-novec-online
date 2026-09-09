import { AppShell } from '@/components/AppShell';
import { PageHeadMetadata } from '@/components/PageHeadMetadata';
import { VideoGrid } from '@/components/VideoGrid';

const Home = () => {
  return (
    <>
      <PageHeadMetadata
        title="MultiScreenChaturbate | 9 kanálů + preview"
        description="Chaturbate multi-view pro 9 současných kanálů s levým preview panelem pro rychlou výměnu."
      />
      <AppShell>
        <VideoGrid />
      </AppShell>
    </>
  );
};

export default Home;
