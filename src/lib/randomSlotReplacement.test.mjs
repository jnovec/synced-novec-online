import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const modulePath = resolve(dirname(fileURLToPath(import.meta.url)), 'randomSlotReplacement.ts');

async function loadPlanner() {
  assert.ok(existsSync(modulePath), 'random slot-replacement planner must be implemented');
  return import(modulePath);
}

const room = (name) => ({ name, url: `https://example.com/${name}` });

test('keeps selected slots and replaces all other visible occupied slots with new unique rooms', async () => {
  const { planRandomSlotReplacement } = await loadPlanner();
  const keep = room('keep');
  const oldA = room('old-a');
  const oldB = room('old-b');
  const replacements = [room('new-a'), room('new-b')];
  const assignments = planRandomSlotReplacement(
    [keep, oldA, oldB],
    [keep, oldA, oldB, ...replacements],
    [0],
    3,
    () => 0,
  );
  assert.deepEqual(assignments.map(({ index }) => index), [1, 2]);
  assert.deepEqual(assignments.map(({ video }) => video.url), replacements.map(({ url }) => url));
});

test('only replaces visible unselected slots and avoids duplicates in assignments', async () => {
  const { planRandomSlotReplacement } = await loadPlanner();
  const assignments = planRandomSlotReplacement(
    [room('keep'), room('old'), room('hidden')],
    [room('new'), room('new'), room('other')],
    [0],
    2,
    () => 0,
  );
  assert.deepEqual(assignments.map(({ index }) => index), [1]);
  assert.deepEqual(assignments.map(({ video }) => video.url), ['https://example.com/new']);
});

test('returns no assignments when all visible slots are selected or no new channels exist', async () => {
  const { planRandomSlotReplacement } = await loadPlanner();
  const existing = room('existing');
  assert.deepEqual(planRandomSlotReplacement([existing], [existing], [0], 1), []);
  assert.deepEqual(planRandomSlotReplacement([existing], [], [], 1), []);
});
