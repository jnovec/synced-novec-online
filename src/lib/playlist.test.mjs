import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildM3uPlaylist } from './playlist.ts';

describe('M3U playlist export', () => {
  it('writes each stream name followed by its direct M3U8 URL', () => {
    const content = buildM3uPlaylist([
      { name: 'alice', streamUrl: 'https://edge.example/alice/master.m3u8?token=abc' },
      { name: 'bob', streamUrl: 'https://edge.example/bob/master.m3u8' },
    ]);

    assert.equal(
      content,
      '#EXTM3U\n#EXTINF:-1,alice\nhttps://edge.example/alice/master.m3u8?token=abc\n#EXTINF:-1,bob\nhttps://edge.example/bob/master.m3u8\n'
    );
  });

  it('rejects entries that are not direct M3U8 streams', () => {
    assert.throws(
      () => buildM3uPlaylist([{ name: 'alice', streamUrl: 'https://chaturbate.com/alice/' }]),
      /M3U8/
    );
  });
});