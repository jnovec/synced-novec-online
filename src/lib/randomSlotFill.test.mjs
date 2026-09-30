import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const modulePath = resolve(dirname(fileURLToPath(import.meta.url)), 'randomSlotFill.ts');

async function loadPlanner() {
  assert.ok(existsSync(modulePath), 'random slot-fill planner must be implemented');
  return import(modulePath);
}

const channel = (name) => ({ name, url: `https://example.com/${name}`, logo: `${name}.jpg` });

test('fills only empty visible slots and leaves occupied slots unchanged', async () => {
  const { planRandomSlotFill } = await loadPlanner();
  const occupied = { name: 'kept', url: 'https://example.com/kept' };
  const slots = [null, occupied, null, null];
  const assignments = planRandomSlotFill(slots, [channel('a'), channel('b'), channel('c')], 3, () => 0);
  assert.deepEqual(assignments.map(({ index }) => index), [0, 2]);
  assert.equal(assignments.length, 2);
  assert.equal(slots[1], occupied);
});

test('does not assign duplicate URLs already present or repeated in candidate sources', async () => {
  const { planRandomSlotFill } = await loadPlanner();
  const alreadyPlaying = channel('a');
  const duplicate = channel('a');
  const assignments = planRandomSlotFill([alreadyPlaying, null, null], [alreadyPlaying, duplicate, channel('b')], 3, () => 0);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].video.url, 'https://example.com/b');
});

test('returns no assignments when there are no empty slots or candidates', async () => {
  const { planRandomSlotFill } = await loadPlanner();
  assert.deepEqual(planRandomSlotFill([channel('a')], [channel('b')], 1), []);
  assert.deepEqual(planRandomSlotFill([null], [], 1), []);
});

test('limits filling to visible grid capacity', async () => {
  const { planRandomSlotFill } = await loadPlanner();
  const assignments = planRandomSlotFill([null, null, null], [channel('a'), channel('b'), channel('c')], 2, () => 0);
  assert.deepEqual(assignments.map(({ index }) => index), [0, 1]);
});
