import assert from 'node:assert/strict';
import test from 'node:test';
import { matchEntries, matchEntry, normalize } from '../src/match.js';

const WATCHED = [{ name: 'Imagine Dragons', aliases: ["אימג'ין דרגונס"] }];
const song = (artist, title = '') => ({ artist, title, structured: true });

test('normalizes case, punctuation and the Hebrew geresh', () => {
  assert.equal(normalize('  IMAGINE  DRAGONS! '), 'imagine dragons');
  assert.equal(normalize("אימג'ין דרגונס"), normalize('אימג׳ין דרגונס'));
  assert.equal(normalize('AC&DC'), 'ac and dc');
});

test('matches the artist however it is written', () => {
  for (const artist of ['Imagine Dragons', 'IMAGINE DRAGONS', 'imagine  dragons',
    'Imagine Dragons feat. JID', 'JID & Imagine Dragons', 'אימג׳ין דרגונס']) {
    assert.ok(matchEntry(song(artist), WATCHED), `should match ${artist}`);
  }
});

test('does not match other bands or partial words', () => {
  for (const artist of ['Dragonforce', 'Imagine', 'The Dragons', 'John Lennon']) {
    assert.equal(matchEntry(song(artist, 'Dragons of old'), WATCHED), null, `should not match ${artist}`);
  }
});

test('matches a cover credited in the title', () => {
  const match = matchEntry(song('Radio Edit', 'Believer (Imagine Dragons)'), WATCHED);
  assert.equal(match.field, 'title');
});

test('searches raw text only when the feed shape was not understood', () => {
  const unstructured = { artist: '', title: '', raw: 'Now: Imagine Dragons / Thunder', structured: false };
  assert.equal(matchEntry(unstructured, WATCHED).field, 'raw');
  assert.equal(matchEntry({ ...unstructured, structured: true }, WATCHED), null);
});

test('returns every matching entry in the feed', () => {
  const hits = matchEntries([song('Imagine Dragons', 'Believer'), song('Oasis', 'Wonderwall'),
    song('Imagine Dragons', 'Bones')], WATCHED);
  assert.deepEqual(hits.map((hit) => hit.title), ['Believer', 'Bones']);
});
