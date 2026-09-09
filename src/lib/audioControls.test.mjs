import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_AUDIO_SETTINGS,
  applyMediaAudio,
  normalizeAudioSettings,
  setAudioMuted,
  setAudioVolume,
} from './audioControls.ts';

describe('audio controls', () => {
  it('starts muted at a useful volume', () => {
    assert.deepEqual(DEFAULT_AUDIO_SETTINGS, { muted: true, volume: 0.5 });
  });

  it('changes mute without losing the selected volume', () => {
    assert.deepEqual(setAudioMuted({ muted: true, volume: 0.7 }, false), { muted: false, volume: 0.7 });
  });

  it('clamps volume to the ReactPlayer range', () => {
    assert.equal(setAudioVolume({ muted: false, volume: 0.5 }, -0.2).volume, 0);
    assert.equal(setAudioVolume({ muted: false, volume: 0.5 }, 1.4).volume, 1);
  });

  it('falls back safely when persisted settings are invalid', () => {
    assert.deepEqual(normalizeAudioSettings({ muted: 'no', volume: 3 }), DEFAULT_AUDIO_SETTINGS);
  });

  it('applies unmute synchronously and resumes the media element', async () => {
    let playCalls = 0;
    const media = {
      muted: true,
      volume: 0,
      play: async () => {
        playCalls += 1;
      },
    };

    await applyMediaAudio(media, { muted: false, volume: 0.7 });

    assert.equal(media.muted, false);
    assert.equal(media.volume, 0.7);
    assert.equal(playCalls, 1);
  });
});
