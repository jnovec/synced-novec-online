import assert from 'node:assert/strict';
import test from 'node:test';
import { isHlsPlaybackUrl } from './playbackUrl.ts';

test('recognizes HLS manifests with query strings and fragments', () => {
  assert.equal(isHlsPlaybackUrl('https://cdn.example/live/index.m3u8'), true);
  assert.equal(isHlsPlaybackUrl('https://cdn.example/live/index.M3U8?token=abc'), true);
  assert.equal(isHlsPlaybackUrl('https://cdn.example/live/index.m3u8#live'), true);
});

test('does not classify direct MP4 and WebM files as HLS', () => {
  assert.equal(isHlsPlaybackUrl('https://cdn.example/video.mp4'), false);
  assert.equal(isHlsPlaybackUrl('https://cdn.example/video.mp4?token=abc'), false);
  assert.equal(isHlsPlaybackUrl('https://cdn.example/video.webm'), false);
});
