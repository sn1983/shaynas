import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMessage, notifierNames, notifyAll } from '../src/notify.js';

test('the message names the song, the time and where to listen', () => {
  const message = formatMessage(
    { artist: 'Imagine Dragons', title: 'Believer', time: '10:04', structured: true },
    { listenUrl: 'https://glz.co.il/glglz' },
  );
  assert.match(message.title, /Imagine Dragons/);
  assert.match(message.body, /Believer/);
  assert.match(message.body, /10:04/);
  assert.match(message.body, /glz\.co\.il/);
  assert.deepEqual(message.song, { artist: 'Imagine Dragons', title: 'Believer', time: '10:04' });
});

test('an unstructured hit still says what was seen', () => {
  const message = formatMessage(
    { artist: '', title: '', time: '', raw: 'Now: Imagine Dragons / Thunder', structured: false,
      match: { artist: 'Imagine Dragons', field: 'raw' } },
    {},
  );
  assert.match(message.title, /Imagine Dragons/);
  assert.match(message.body, /Thunder/);
});

test('a channel that is not set up is reported, not thrown', async () => {
  const results = await notifyAll({ title: 't', body: 'b' }, { selected: ['telegram'], env: {} });
  assert.deepEqual(results, [{ name: 'telegram', ok: false, error: 'missing configuration - see .env.example' }]);
});

test('an unknown channel names the ones that exist', async () => {
  const [result] = await notifyAll({ title: 't', body: 'b' }, { selected: ['carrier-pigeon'], env: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown notifier/);
});

test('a dry run only prints', async () => {
  const logged = [];
  const original = console.log;
  console.log = (...args) => logged.push(args.join(' '));
  try {
    const results = await notifyAll({ title: 'hi', body: 'there' },
      { selected: ['telegram'], env: { TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: 'y' }, dryRun: true });
    assert.deepEqual(results, [{ name: 'console', ok: true }]);
  } finally {
    console.log = original;
  }
  assert.match(logged.join('\n'), /there/);
});

test('every channel in .env.example is wired up', () => {
  assert.deepEqual(notifierNames().sort(), ['console', 'ntfy', 'pushover', 'telegram', 'webhook']);
});
