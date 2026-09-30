import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planRandomSlotReplacement } from './randomSlotReplacement.ts';

const room = (url) => ({ url });

describe('random slot replacement', () => {
  it('preserves selected slots and randomly replaces every other visible slot', () => {
    const slots = [room('keep'), room('replace-a'), room('replace-b')];
    const candidates = [room('keep'), room('replace-a'), room('replace-b'), room('new-a'), room('new-b'), room('new-c')];
    const assignments = planRandomSlotReplacement(slots, candidates, [0], 3, () => 0);
    assert.deepEqual(assignments.map(({ index }) => index), [1, 2]);
    assert.deepEqual(assignments.map(({ video }) => video.url), ['new-a', 'new-b']);
  });

  it('does not assign duplicate candidate URLs or replace hidden slots', () => {
    const slots = [room('keep'), room('old'), room('hidden')];
    const candidates = [room('new'), room('new'), room('other')];
    const assignments = planRandomSlotReplacement(slots, candidates, [0], 2, () => 0);
    assert.deepEqual(assignments.map(({ index }) => index), [1]);
    assert.deepEqual(assignments.map(({ video }) => video.url), ['new']);
  });
});
