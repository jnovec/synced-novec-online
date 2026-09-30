import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const modulePath = resolve(dirname(fileURLToPath(import.meta.url)), 'clearGridSlots.ts');

async function loadClearHelper() {
  assert.ok(existsSync(modulePath), 'clear-grid slot helper must be implemented');
  return import(modulePath);
}

test('returns every occupied grid slot, including display-share slots without a URL', async () => {
  const { getOccupiedGridSlotIndexes } = await loadClearHelper();
  assert.deepEqual(getOccupiedGridSlotIndexes([
    { name: 'stream', url: 'https://example.com/1' },
    null,
    { name: 'shared window', url: '', sourceType: 'display', sourceId: 'track-1' },
    null,
  ]), [0, 2]);
});

test('returns an empty list when the grid has nothing to release', async () => {
  const { getOccupiedGridSlotIndexes } = await loadClearHelper();
  assert.deepEqual(getOccupiedGridSlotIndexes([null, null]), []);
});
