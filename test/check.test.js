// End-to-end over a local stand-in for the station's feed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runOnce } from '../src/check.js';
import { fetchFeed } from '../src/feed.js';

const ROWS = `<?xml version="1.0" encoding="utf-8"?>
<XML>
  <ROW><TITLE>Believer</TITLE><ARTIST>Imagine Dragons</ARTIST><TIME>10:04</TIME></ROW>
  <ROW><TITLE>Wonderwall</TITLE><ARTIST>Oasis</ARTIST><TIME>10:00</TIME></ROW>
</XML>`;

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/onair.xml`, close: () => server.close() };
}

async function quietly(run) {
  const log = console.log;
  console.log = () => {};
  try {
    return await run();
  } finally {
    console.log = log;
  }
}

test('notifies once per play and remembers it', async (t) => {
  const feed = await serve((request, response) => {
    response.writeHead(200, { 'content-type': 'text/xml' });
    response.end(ROWS);
  });
  t.after(feed.close);

  const config = {
    feedUrl: feed.url,
    listenUrl: 'https://glz.co.il/glglz',
    dedupeMinutes: 30,
    notifiers: ['console'],
    artists: [{ name: 'Imagine Dragons' }],
  };
  const statePath = join(await mkdtemp(join(tmpdir(), 'glglz-')), 'notified.json');

  const first = await quietly(() => runOnce({ config, statePath, dryRun: true }));
  assert.equal(first.entries.length, 2);
  assert.deepEqual(first.sent.map((item) => item.entry.title), ['Believer']);
  assert.match(first.sent[0].message.body, /10:04/);

  const second = await quietly(() => runOnce({ config, statePath, dryRun: true }));
  assert.equal(second.hits.length, 1, 'the song is still on the feed');
  assert.equal(second.sent.length, 0, 'but it is not reported twice');

  const later = await quietly(() => runOnce({
    config, statePath, dryRun: true, now: () => Date.now() + 31 * 60 * 1000,
  }));
  assert.equal(later.sent.length, 1, 'the dedupe window eventually expires');
});

test('retries a failing feed and asks for a fresh copy', async (t) => {
  let attempts = 0;
  const seenQueries = [];
  const feed = await serve((request, response) => {
    attempts += 1;
    seenQueries.push(request.url);
    if (attempts === 1) {
      response.writeHead(503);
      response.end('busy');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/xml' });
    response.end(ROWS);
  });
  t.after(feed.close);

  const xml = await fetchFeed(feed.url, { backoffMs: 1 });
  assert.match(xml, /Believer/);
  assert.equal(attempts, 2);
  assert.match(seenQueries[0], /\?_=\d+/);
});

test('a feed that never answers fails loudly', async (t) => {
  const feed = await serve((request, response) => {
    response.writeHead(500);
    response.end('down');
  });
  t.after(feed.close);
  await assert.rejects(() => fetchFeed(feed.url, { retries: 1, backoffMs: 1 }), /HTTP 500/);
});
