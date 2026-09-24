import assert from 'node:assert/strict';
import test from 'node:test';
import { findFirstEmptyVisibleSlot } from './slotSelection.ts';

test('chooses an empty slot inside the visible grid', () => {
  assert.equal(findFirstEmptyVisibleSlot([null, null, null, null], 4), 0);
  assert.equal(findFirstEmptyVisibleSlot([{ url: '/occupied' }, null, null, null], 4), 1);
});

test('does not choose a hidden slot when every visible slot is occupied', () => {
  assert.equal(findFirstEmptyVisibleSlot([{ url: '/one' }, { url: '/two' }, null, null], 2), -1);
});
