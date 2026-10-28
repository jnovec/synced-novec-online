import assert from 'node:assert/strict';
import test from 'node:test';
import { findStreamSourceAdapter, streamSourceAdapters } from './streamSourceAdapters.ts';

test('registers dedicated adapter identities for each newly supported source family', () => {
  assert.deepEqual(streamSourceAdapters.map(({ id }) => id), [
    'cams.com', 'streamate.com', 'flirt4free.com', 'xlovecam.com',
    'dreamcam.com', 'eplay.com', 'sinparty.com',
  ]);
});

test('matches Cams.com and StreamRay as the same adapter including subdomains', () => {
  assert.equal(findStreamSourceAdapter(new URL('https://www.cams.com/alice'))?.id, 'cams.com');
  assert.equal(findStreamSourceAdapter(new URL('https://streamray.com/alice'))?.id, 'cams.com');
  assert.equal(findStreamSourceAdapter(new URL('https://api.streamray.com/v1'))?.id, 'cams.com');
});

test('matches only exact domains or their subdomains, not deceptive suffixes', () => {
  assert.equal(findStreamSourceAdapter(new URL('https://www.streamate.com/cam/alice'))?.id, 'streamate.com');
  assert.equal(findStreamSourceAdapter(new URL('https://streamate.com.attacker.test/cam/alice')), undefined);
  assert.equal(findStreamSourceAdapter(new URL('https://unknown.example/')), undefined);
});
