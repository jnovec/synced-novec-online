import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAllowedHlsUpstream, rewriteHlsPlaylist } from './hlsProxy.ts';

describe('HLS proxy', () => {
  it('only permits HTTPS Chaturbate edge stream URLs', () => {
    assert.equal(isAllowedHlsUpstream('https://edge1-waw.live.mmcdn.com/v1/edge/streams/room/llhls.m3u8'), true);
    assert.equal(isAllowedHlsUpstream('http://127.0.0.1/private'), false);
    assert.equal(isAllowedHlsUpstream('https://evil.example/v1/edge/streams/room/llhls.m3u8'), false);
  });

  it('rewrites playlist lines and URI attributes through the local proxy', () => {
    const upstream = 'https://edge1-waw.live.mmcdn.com/v1/edge/streams/room/master.m3u8?token=x';
    const playlist = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8?session=1"',
      '#EXT-X-MAP:URI="init.mp4"',
      'video.m3u8?session=1',
      '',
    ].join('\n');

    const rewritten = rewriteHlsPlaylist(playlist, upstream, '/api/chaturbate-hls.m3u8');

    assert.match(rewritten, /url=https%3A%2F%2Fedge1-waw\.live\.mmcdn\.com%2Fv1%2Fedge%2Fstreams%2Froom%2Faudio\.m3u8%3Fsession%3D1/);
    assert.match(rewritten, /URI="\/api\/chaturbate-hls\.m3u8\?url=.*init\.mp4/);
    assert.match(rewritten, /\/api\/chaturbate-hls\.m3u8\?url=.*video\.m3u8/);
  });

});
