import test from 'node:test';
import assert from 'node:assert/strict';
import { FragmentCache, STREAM_CACHE_BYTES } from './fragmentCache.ts';
test('enforces byte budget and expires old segments', () => {
  assert.equal(STREAM_CACHE_BYTES, 1_000_000_000);
  const cache = new FragmentCache(8, 60);
  cache.put('a', new ArrayBuffer(5), 0);
  cache.put('b', new ArrayBuffer(5), 1);
  assert.equal(cache.get('a', 2), undefined);
  assert.equal(cache.get('b', 2).byteLength, 5);
  assert.equal(cache.get('b', 61), undefined);
});
