import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSessionShareUrl,
  createAppSession,
  getPastesIdFromLocation,
  normalizeAppSession,
  parsePastesId,
} from './session.ts';

describe('session snapshots', () => {
  it('keeps remote streams and display placeholders', () => {
    const session = createAppSession({
      name: 'Party',
      gridSize: 2,
      slots: [
        { name: 'room', url: 'https://chaturbate.com/room/' },
        { name: 'djay', url: '', sourceType: 'display', sourceId: 'temporary-track' },
      ],
      audioSettings: [{ muted: false, volume: 0.8 }],
      selectedVideo: null,
    });
    assert.equal(session.slots[0]?.url, 'https://chaturbate.com/room/');
    assert.equal(session.slots[1]?.sourceType, 'display');
    assert.equal(session.slots[1]?.sourceId, undefined);
    assert.deepEqual(session.audioSettings[0], { muted: false, volume: 0.8 });
  });

  it('normalizes malformed optional values safely', () => {
    const session = normalizeAppSession({ version: 1, name: '', gridSize: 99, slots: [] });
    assert.equal(session.gridSize, 9);
    assert.equal(session.slots.length, 18);
  });

  it('accepts the 18-screen grid size', () => {
    const session = normalizeAppSession({ version: 1, name: '18 screens', gridSize: 18, slots: [] });
    assert.equal(session.gridSize, 18);
    assert.equal(session.slots.length, 18);
    assert.equal(session.audioSettings.length, 18);
  });

  it('accepts Pastes.io slugs and links', () => {
    assert.equal(parsePastesId('my-session-Ab12Cd34'), 'my-session-Ab12Cd34');
    assert.equal(parsePastesId('https://pastes.io/my-session-Ab12Cd34'), 'my-session-Ab12Cd34');
    assert.equal(parsePastesId('https://pastes.io/raw/my-session-Ab12Cd34'), 'my-session-Ab12Cd34');
    assert.equal(parsePastesId('https://synced.novec.online/?session=my-session-Ab12Cd34'), 'my-session-Ab12Cd34');
    assert.equal(parsePastesId('https://synced.novec.online/s/my-session-Ab12Cd34'), 'my-session-Ab12Cd34');
    assert.equal(parsePastesId('https://example.com/my-session-Ab12Cd34'), null);
  });

  it('reads a session ID from a shared location', () => {
    assert.equal(
      getPastesIdFromLocation({ pathname: '/', search: '?session=my-session-Ab12Cd34' }),
      'my-session-Ab12Cd34'
    );
    assert.equal(
      getPastesIdFromLocation({ pathname: '/s/my-session-Ab12Cd34', search: '' }),
      'my-session-Ab12Cd34'
    );
    assert.equal(getPastesIdFromLocation({ pathname: '/', search: '?session=not%20valid' }), null);
    assert.equal(getPastesIdFromLocation({ pathname: '/s/%broken', search: '' }), null);
  });

  it('builds the canonical synced.novec.online share link', () => {
    assert.equal(
      buildSessionShareUrl('https://pastes.io/my-session-Ab12Cd34'),
      'https://synced.novec.online/?session=my-session-Ab12Cd34'
    );
    assert.equal(
      buildSessionShareUrl('my-session-Ab12Cd34', 'http://localhost:3000/something?old=1'),
      'http://localhost:3000/?session=my-session-Ab12Cd34'
    );
  });
});
