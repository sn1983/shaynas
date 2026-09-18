import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseEntries } from '../src/parse.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const pairs = (entries) => entries.map((entry) => [entry.artist, entry.title, entry.time]);

test('reads one element per song', () => {
  assert.deepEqual(pairs(parseEntries(fixture('dalet-rows.xml'))), [
    ['Imagine Dragons', 'Believer', '10:04'],
    ['Oasis', 'Wonderwall', '10:00'],
  ]);
});

test('reads songs held in attributes, keeping siblings apart', () => {
  assert.deepEqual(pairs(parseEntries(fixture('attributes.xml'))), [
    ['Imagine Dragons & JID', 'Enemy', '09:12'],
    ['Oasis', 'Live Forever', '09:08'],
  ]);
});

test('splits a single "artist - title" field and ignores the programme name', () => {
  const entries = parseEntries(fixture('combined.xml'));
  assert.deepEqual(pairs(entries), [
    ['Imagine Dragons', 'Radioactive', '11:20'],
    ['Coldplay', 'Yellow', '11:15'],
  ]);
  assert.ok(!entries.some((entry) => entry.title.includes('גלגלצ')));
});

test('reads Hebrew field names', () => {
  assert.deepEqual(pairs(parseEntries(fixture('hebrew.xml'))), [["אימג'ין דרגונס", 'Bones', '08:31']]);
});

test('falls back to raw text when no field looks like a song', () => {
  const entries = parseEntries(fixture('unknown-shape.xml'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].structured, false);
  assert.match(entries[0].raw, /Imagine Dragons/);
});

test('an empty document yields nothing', () => {
  assert.deepEqual(parseEntries('<XML></XML>'), []);
});
