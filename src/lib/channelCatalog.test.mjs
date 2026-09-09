import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeCurrentRooms, roomPageOffset } from './channelCatalog.ts';

describe('current room refresh', () => {
  it('converts catalog pages to the provider offset', () => {
    assert.equal(roomPageOffset(1), 0);
    assert.equal(roomPageOffset(2), 40);
    assert.equal(roomPageOffset(5), 160);
  });

  it('merges successful pages, removes duplicates and sorts by viewers', () => {
    const rooms = mergeCurrentRooms([
      [{ name: 'alice', url: 'https://chaturbate.com/alice/', viewers: 10 }],
      [
        { name: 'bob', url: 'https://chaturbate.com/bob/', viewers: 50 },
        { name: 'alice', url: 'https://chaturbate.com/alice/', viewers: 10 },
      ],
    ]);

    assert.deepEqual(rooms.map((room) => room.name), ['bob', 'alice']);
  });
});