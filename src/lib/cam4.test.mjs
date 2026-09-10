import assert from 'node:assert/strict';
import test from 'node:test';
import { isCam4TechnicalChannel, parseCam4Listing } from './cam4.ts';

test('CAM4 associates embedded HLS with performer identity', () => {
  const html = `
    <script>
      window.__CAM4_DATA__ = {
        "username":"alice_cam4",
        "displayName":"Alice CAM4",
        "viewerCount":123,
        "thumbnail":"https:\\/\\/images.example.com\\/alice.jpg",
        "streamUrl":"https:\\/\\/cam4-hls.xcdnpro.com\\/live\\/playlist.m3u8"
      };
    </script>
  `;

  const channels = parseCam4Listing(html, new URL('https://www.cam4.com/'));
  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, 'Alice CAM4');
  assert.equal(channels[0].url, 'https://www.cam4.com/alice_cam4/');
  assert.equal(channels[0].playbackUrl, 'https://cam4-hls.xcdnpro.com/live/playlist.m3u8');
  assert.equal(channels[0].viewers, 123);
});

test('CAM4 technical HLS labels are recognized as fallback noise', () => {
  assert.equal(
    isCam4TechnicalChannel({
      name: 'playlist',
      location: 'cam4-hls.xcdnpro.com',
      url: 'https://cam4-hls.xcdnpro.com/live/playlist.m3u8',
      logo: '',
      playbackUrl: 'https://cam4-hls.xcdnpro.com/live/playlist.m3u8',
    }),
    true
  );

  assert.equal(
    isCam4TechnicalChannel({
      name: 'alice_cam4',
      location: 'cam4.com',
      url: 'https://www.cam4.com/alice_cam4/',
      logo: '',
    }),
    false
  );
});
