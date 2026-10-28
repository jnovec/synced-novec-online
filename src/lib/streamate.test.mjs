import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStreamateManifestUrl, extractStreamateModel, parseStreamateManifest } from './streamate.ts';

test('extracts a Streamate room model only from /cam/<name> URLs', () => {
  assert.equal(extractStreamateModel(new URL('https://www.streamate.com/cam/Alice_1')), 'Alice_1');
  assert.equal(extractStreamateModel(new URL('https://streamate.com/')), null);
  assert.equal(extractStreamateModel(new URL('https://notstreamate.com/cam/alice')), null);
});

test('builds manifest endpoint and returns only HTTPS HLS URLs', () => {
  assert.equal(buildStreamateManifestUrl('Alice').toString(), 'https://manifest-server.naiadsystems.com/live/s:Alice.json');
  const page = new URL('https://www.streamate.com/cam/Alice');
  assert.deepEqual(parseStreamateManifest({ formats: { 'mp4-hls': 'https://cdn.example/live.m3u8?token=x' } }, page), {
    name: 'Alice', location: 'streamate.com', url: page.toString(), logo: '', playbackUrl: 'https://cdn.example/live.m3u8?token=x',
  });
  assert.equal(parseStreamateManifest({ formats: { 'mp4-hls': 'http://cdn.example/live.m3u8' } }, page), null);
  assert.equal(parseStreamateManifest({ formats: { 'mp4-hls': 'https://cdn.example/live.mp4' } }, page), null);
});
