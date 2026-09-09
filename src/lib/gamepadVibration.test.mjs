import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audioLevelToVibration } from './gamepadVibration.ts';

describe('audio-driven gamepad vibration', () => {
  it('keeps quiet background noise below the vibration gate', () => {
    assert.equal(audioLevelToVibration(0.02, 2.4), 0);
  });

  it('increases vibration with audio level and sensitivity', () => {
    const quiet = audioLevelToVibration(0.08, 1);
    const loud = audioLevelToVibration(0.45, 1);
    const sensitive = audioLevelToVibration(0.08, 3);
    assert.ok(quiet > 0);
    assert.ok(loud > quiet);
    assert.ok(sensitive > quiet);
  });

  it('never exceeds the Gamepad API magnitude range', () => {
    assert.equal(audioLevelToVibration(2, 5), 1);
  });
});
