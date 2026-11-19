import test from 'node:test';
import assert from 'node:assert/strict';
import { bufferedAhead, startupBufferReady } from './streamBuffer.ts';
const ranges = (...pairs) => ({ length: pairs.length, start: i => pairs[i][0], end: i => pairs[i][1] });
test('startup requires four seconds of contiguous media at the playhead', () => {
  assert.equal(bufferedAhead(ranges([10, 12], [13, 25]), 10), 2);
  assert.equal(startupBufferReady(ranges([10, 12], [13, 25]), 10, Infinity), false);
  assert.equal(startupBufferReady(ranges([10, 15]), 10, Infinity), true);
});
test('allows a short stream when the remaining duration is buffered', () => {
  assert.equal(startupBufferReady(ranges([0, 2]), 0, 2), true);
  assert.equal(startupBufferReady(ranges(), 0, 2), false);
});
