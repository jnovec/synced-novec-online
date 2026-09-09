import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractEmbeddedMediaUrls,
  extractVideoChannels,
  normalizeSourceUrl,
  sourceCategoryName,
} from './sourceDiscovery.ts';
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

test('rejects private and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '172.16.4.2', '192.168.1.5', '169.254.1.1', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress('1.1.1.1'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});
