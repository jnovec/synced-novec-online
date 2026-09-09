import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createDisplaySlot,
  mediaStreamHasAudio,
  serializePersistentSlots,
  stopMediaStream,
} from './displayMedia.ts';

describe('display media slot lifecycle', () => {
  it('creates a local display slot from the selected video track', () => {
    const slot = createDisplaySlot({ id: 'track-1', label: 'djay' });

    assert.deepEqual(slot, {
      name: 'djay',
      url: '',
      sourceType: 'display',
      sourceId: 'track-1',
    });
  });

  it('uses a readable fallback when the browser does not expose a window label', () => {
    assert.equal(createDisplaySlot({ id: 'track-2', label: '' }).name, 'App/Window Share');
  });

  it('does not persist local display shares across reloads', () => {
    const remote = { name: 'room', url: 'https://chaturbate.com/room/' };
    const display = createDisplaySlot({ id: 'track-1', label: 'djay' });

    assert.deepEqual(serializePersistentSlots([remote, display, null]), [remote, null, null]);
  });

  it('stops every media track when a share is replaced or cleared', () => {
    const calls = [];
    const stream = {
      getTracks: () => [
        { stop: () => calls.push('video') },
        { stop: () => calls.push('audio') },
      ],
    };

    stopMediaStream(stream);
    assert.deepEqual(calls, ['video', 'audio']);
  });

  it('detects whether the user included system audio in display capture', () => {
    assert.equal(mediaStreamHasAudio({ getAudioTracks: () => [{}] }), true);
    assert.equal(mediaStreamHasAudio({ getAudioTracks: () => [] }), false);
  });
});
