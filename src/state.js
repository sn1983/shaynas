// Remembers which plays were already reported, so a feed that keeps showing the
// same song (or two polling runs overlapping) does not notify twice.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalize } from './match.js';

const VERSION = 1;

export function playKey(entry) {
  return [normalize(entry.artist), normalize(entry.title), normalize(entry.time)].join('|');
}

export async function loadState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed?.version === VERSION && parsed.notified) return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`state: ignoring unreadable ${path} (${error.message})`);
    }
  }
  return { version: VERSION, notified: {} };
}

export async function saveState(path, state, { now = Date.now(), keepMs = 24 * 60 * 60 * 1000 } = {}) {
  const notified = {};
  for (const [key, value] of Object.entries(state.notified)) {
    if (now - value.at <= keepMs) notified[key] = value;
  }
  const payload = JSON.stringify({ version: VERSION, notified }, null, 2);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, payload);
  await rename(temporary, path);
}

export function alreadyNotified(state, entry, { now = Date.now(), dedupeMs }) {
  const previous = state.notified[playKey(entry)];
  if (!previous) return false;
  return now - previous.at < dedupeMs;
}

export function remember(state, entry, { now = Date.now() } = {}) {
  state.notified[playKey(entry)] = {
    at: now,
    artist: entry.artist,
    title: entry.title,
    time: entry.time,
  };
  return state;
}
