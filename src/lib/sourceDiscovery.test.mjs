import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractEmbeddedMediaUrls,
  extractVideoChannels,
  normalizeSourceUrl,
  sourceCategoryName,
} from './sourceDiscovery.ts';
import {
  buildBongaListingUrl,
  parseBongaListing,
  parseBongaRoomStream,
} from './bongacams.ts';
import {
  buildChaturbateListingUrl,
  parseChaturbateListing,
} from './chaturbateSource.ts';
import { parseCamSodaListing } from './camsoda.ts';
import { isPublicIpAddress } from './safeRemoteFetch.ts';

test('normalizes a bare domain and uses it as the category name', () => {
  const url = normalizeSourceUrl('www.bongacams.com');
  assert.equal(url.toString(), 'https://www.bongacams.com/');
  assert.equal(sourceCategoryName(url), 'bongacams.com');
});

test('extracts Bonga-style profile cards and their preview media', () => {
  const html = `
    <a class="model-card live-preview" href="/profile/alice" aria-label="Alice Live">
      <video data-src="https:\\/\\/cdn.example.com\\/alice.m3u8"></video>
      <img data-src="//img.example.com/alice.jpg" alt="Alice">
      <span>123 viewers</span>
    </a>
    <a href="/categories/live"><img src="/navigation.jpg" alt="Categories"></a>
    <a href="/profile/bob"><img src="/bob.jpg" alt="Bob"></a>
  `;
  const channels = extractVideoChannels(html, new URL('https://bongacams.com/'));

  assert.equal(channels.length, 3);
  assert.deepEqual(channels[0], {
    name: 'Alice Live',
    location: '123 viewers · bongacams.com',
    url: 'https://bongacams.com/profile/alice',
    logo: 'https://img.example.com/alice.jpg',
    playbackUrl: 'https://cdn.example.com/alice.m3u8',
  });
  assert.equal(channels[1].name, 'Bob');
  assert.equal(channels[1].url, 'https://bongacams.com/profile/bob');
  assert.equal(channels[2].playbackUrl, 'https://cdn.example.com/alice.m3u8');
});

test('extracts escaped direct media links once', () => {
  const html = `{"hls":"https:\\/\\/media.example.com\\/live.m3u8?token=abc"}`;
  assert.deepEqual(extractEmbeddedMediaUrls(html, new URL('https://example.com')), [
    'https://media.example.com/live.m3u8?token=abc',
  ]);
});

test('builds and parses the BongaCams live listing', () => {
  const sourceUrl = new URL('https://bongacams.com/');
  const listingUrl = buildBongaListingUrl(sourceUrl);
  assert.equal(listingUrl.pathname, '/tools/listing_v3.php');
  assert.equal(listingUrl.searchParams.get('livetab'), 'all');

  const channels = parseBongaListing(
    {
      models: [
        {
          username: 'alice_live',
          display_name: 'Alice',
          thumb_image: '//img.example.com/alice.{ext}',
          viewers: 321,
          gender: 'female',
          room: 'public',
          esid: 'edge-1',
        },
        { username: 'private_room', room: 'private', viewers: 999 },
      ],
    },
    sourceUrl
  );

  assert.deepEqual(channels, [
    {
      name: 'Alice',
      location: '321 viewers · female',
      url: 'https://bongacams.com/alice_live',
      logo: 'https://img.example.com/alice.webp',
      playbackUrl: 'https://edge-1.bcvcdn.com/hls/stream_alice_live/public-aac/stream_alice_live/chunks.m3u8',
      viewers: 321,
    },
  ]);
});

test('extracts a public BongaCams HLS stream from room data', () => {
  assert.equal(
    parseBongaRoomStream(
      {
        status: 'success',
        performerData: { isOnline: true, showType: 'public' },
        localData: { videoServerUrl: '//edge-2.bcvcdn.com' },
      },
      'alice_live'
    ),
    'https://edge-2.bcvcdn.com/hls/stream_alice_live/playlist.m3u8'
  );
});

test('builds and parses the Chaturbate room listing', () => {
  const sourceUrl = new URL('https://chaturbate.com/female-cams/');
  const listingUrl = buildChaturbateListingUrl(sourceUrl);
  assert.equal(listingUrl.pathname, '/api/ts/roomlist/room-list/');
  assert.equal(listingUrl.searchParams.get('genders'), 'f');

  const channels = parseChaturbateListing(
    {
      rooms: [
        {
          username: 'alice_cb',
          display_age: 24,
          current_show: 'public',
          img: '//roomimg.example.com/alice.jpg',
          num_users: 456,
          gender: 'f',
        },
        { username: 'private_cb', current_show: 'private', num_users: 999 },
      ],
    },
    sourceUrl
  );

  assert.deepEqual(channels, [
    {
      name: 'alice_cb (24)',
      location: '456 viewers · female',
      url: 'https://chaturbate.com/alice_cb/',
      logo: 'https://roomimg.example.com/alice.jpg',
      viewers: 456,
    },
  ]);
});

test('parses CamSoda live model cards', () => {
  const channels = parseCamSodaListing(
    `
      <a class="model-card" data-username="alice_cam">
        <img data-thumb-image="//img.example.com/alice.jpg" alt="Alice Cam">
        <span>123 viewers</span>
      </a>
      <a class="model-card" data-username="bob_cam"><img src="/bob.jpg"></a>
    `,
    new URL('https://www.camsoda.com/')
  );

  assert.equal(channels.length, 2);
  assert.equal(channels[0].name, 'Alice Cam');
  assert.equal(channels[0].location, '123 viewers · camsoda.com');
  assert.equal(channels[0].url, 'https://www.camsoda.com/alice_cam/');
  assert.equal(channels[0].logo, 'https://img.example.com/alice.jpg');
});

test('rejects private and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '172.16.4.2', '192.168.1.5', '169.254.1.1', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress('1.1.1.1'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});
