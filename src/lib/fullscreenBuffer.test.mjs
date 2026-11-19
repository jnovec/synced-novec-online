import test from 'node:test';
import assert from 'node:assert/strict';
import { isCacheOnlySlot } from './streamBuffer.ts';
test('only the selected tile plays in fullscreen', () => {
  assert.equal(isCacheOnlySlot(null, 0), false);
  assert.equal(isCacheOnlySlot(0, 0), false);
  assert.equal(isCacheOnlySlot(0, 1), true);
  assert.equal(isCacheOnlySlot(1, 0), true);
});
