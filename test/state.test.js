import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { alreadyNotified, loadState, remember, saveState } from '../src/state.js';

const MINUTE = 60 * 1000;
const song = { artist: 'Imagine Dragons', title: 'Believer', time: '10:04' };

async function statePath() {
  const directory = await mkdtemp(join(tmpdir(), 'glglz-'));
  return join(directory, 'nested', 'notified.json');
}

test('a missing state file starts empty', async () => {
  const state = await loadState(await statePath());
  assert.deepEqual(state.notified, {});
});

test('the same play is reported once, a later play again', async () => {
  const state = remember({ notified: {} }, song, { now: 0 });
  assert.ok(alreadyNotified(state, song, { now: 5 * MINUTE, dedupeMs: 30 * MINUTE }));
  assert.ok(!alreadyNotified(state, song, { now: 45 * MINUTE, dedupeMs: 30 * MINUTE }));
  assert.ok(!alreadyNotified(state, { ...song, time: '14:20' }, { now: MINUTE, dedupeMs: 30 * MINUTE }));
});

test('matching ignores case and spacing differences between polls', () => {
  const state = remember({ notified: {} }, song, { now: 0 });
  const restated = { artist: 'IMAGINE  DRAGONS', title: 'believer', time: '10:04' };
  assert.ok(alreadyNotified(state, restated, { now: MINUTE, dedupeMs: 30 * MINUTE }));
});

test('saving creates the directory, reloads, and drops stale entries', async () => {
  const path = await statePath();
  const state = remember({ version: 1, notified: {} }, song, { now: 1000 });
  remember(state, { artist: 'Oasis', title: 'Wonderwall', time: '10:00' }, { now: 1000 });

  await saveState(path, state, { now: 1000 });
  const reloaded = await loadState(path);
  assert.equal(Object.keys(reloaded.notified).length, 2);

  await saveState(path, reloaded, { now: 1000 + 48 * 60 * MINUTE });
  assert.deepEqual((await loadState(path)).notified, {});
  assert.match(await readFile(path, 'utf8'), /"version": 1/);
});

test('an unreadable state file does not stop the run', async () => {
  const path = await statePath();
  await saveState(path, { version: 1, notified: {} });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, 'not json at all');
  assert.deepEqual((await loadState(path)).notified, {});
});
