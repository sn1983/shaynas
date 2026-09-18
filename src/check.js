#!/usr/bin/env node
// Polls the Galgalatz on-air feed and notifies when a watched artist is playing.
//
//   node src/check.js                 one look at the feed
//   node src/check.js --watch         keep looking (used by the GitHub Action)
//   node src/check.js --dry-run       print instead of notifying

import { loadConfig } from './config.js';
import { isTrue, parseArgs, parseDuration } from './cli.js';
import { describeEntry, parseEntries } from './parse.js';
import { fetchFeed } from './feed.js';
import { matchEntries } from './match.js';
import { formatMessage, notifyAll } from './notify.js';
import { alreadyNotified, loadState, remember, saveState } from './state.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runOnce({ config, statePath, dryRun, verbose, now = () => Date.now() }) {
  const xml = await fetchFeed(config.feedUrl);
  const entries = parseEntries(xml);

  if (entries.length === 1 && !entries[0].structured) {
    console.warn('feed: could not find artist/title fields - falling back to a text search. '
      + 'Run "npm run feed" to see what the station is publishing.');
  }
  if (verbose) {
    console.log(`feed: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
    for (const entry of entries) console.log(`  - ${describeEntry(entry)}${entry.time ? ` (${entry.time})` : ''}`);
  }

  const hits = matchEntries(entries, config.artists);
  const state = await loadState(statePath);
  const dedupeMs = config.dedupeMinutes * 60 * 1000;
  const sent = [];

  for (const hit of hits) {
    const at = now();
    if (alreadyNotified(state, hit, { now: at, dedupeMs })) {
      if (verbose) console.log(`skip (already reported): ${describeEntry(hit)}`);
      continue;
    }
    const message = formatMessage(hit, { listenUrl: config.listenUrl });
    const results = await notifyAll(message, { selected: config.notifiers, dryRun });
    for (const result of results) {
      if (!result.ok) console.error(`notify via ${result.name} failed: ${result.error}`);
    }
    if (results.some((result) => result.ok)) {
      remember(state, hit, { now: at });
      sent.push({ entry: hit, message });
      console.log(`notified: ${describeEntry(hit)}`);
    }
  }

  await saveState(statePath, state, { now: now() });
  return { entries, hits, sent };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (isTrue(options.help)) {
    console.log('usage: node src/check.js [--watch] [--interval 45s] [--duration 5m] [--dry-run] '
      + '[--notifiers telegram,ntfy] [--artist "Imagine Dragons"] [--config path] [--state path] [--verbose]');
    return 0;
  }

  const config = await loadConfig({
    path: options.config ?? 'config/watchlist.json',
    options,
  });
  const statePath = options.state ?? process.env.STATE_FILE ?? 'state/notified.json';
  const dryRun = isTrue(options['dry-run']);
  const verbose = isTrue(options.verbose);

  console.log(`watching ${config.artists.map((artist) => artist.name).join(', ')} on ${config.feedUrl}`);
  console.log(`notifying via ${dryRun ? 'console (dry run)' : config.notifiers.join(', ')}`);

  if (!isTrue(options.watch)) {
    await runOnce({ config, statePath, dryRun, verbose });
    return 0;
  }

  const interval = parseDuration(options.interval, config.pollSeconds * 1000);
  const duration = parseDuration(options.duration, 0);
  const until = duration > 0 ? Date.now() + duration : Infinity;
  console.log(`polling every ${Math.round(interval / 1000)}s`
    + (duration > 0 ? ` for ${Math.round(duration / 60000)} minutes` : ' until stopped'));

  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { stopping = true; });
  }

  while (!stopping) {
    try {
      await runOnce({ config, statePath, dryRun, verbose });
    } catch (error) {
      // A blip on the station's side must not end the run; the next poll retries.
      console.error(`poll failed: ${error.message}`);
    }
    const next = Date.now() + interval;
    if (next > until) break;
    while (!stopping && Date.now() < next) await sleep(Math.min(500, next - Date.now()));
  }
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
