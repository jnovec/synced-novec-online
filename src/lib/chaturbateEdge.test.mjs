import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEdgeStreamResponse } from './chaturbateEdge.ts';

describe('Chaturbate edge response', () => {
  it('accepts a fresh direct M3U8 URL with room status', () => {
    assert.deepEqual(
      parseEdgeStreamResponse({ success: true, url: 'https://edge.example/live/llhls.m3u8?token=abc', room_status: 'public' }),
      { streamUrl: 'https://edge.example/live/llhls.m3u8?token=abc', roomStatus: 'public' }
    );
  });

  it('does not expose non-M3U8 URLs', () => {
    assert.deepEqual(
      parseEdgeStreamResponse({ success: true, url: 'https://example.com/room', room_status: 'public' }),
      { streamUrl: null, roomStatus: 'public' }
    );
  });
});
