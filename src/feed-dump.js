#!/usr/bin/env node
// Prints the raw feed and what the parser makes of it. The station's XML is not
// documented, so this is the tool to reach for when something looks off.

import { fetchFeed } from './feed.js';
import { loadConfig } from './config.js';
import { parseArgs } from './cli.js';
import { describeEntry, parseEntries } from './parse.js';

const options = parseArgs(process.argv.slice(2));
const config = await loadConfig({ path: options.config ?? 'config/watchlist.json', options });
const xml = await fetchFeed(config.feedUrl);

console.log('--- raw feed ---');
console.log(xml.trim());
console.log('--- parsed ---');
for (const entry of parseEntries(xml)) {
  console.log(`${entry.structured ? '' : '[unstructured] '}${describeEntry(entry)}${entry.time ? ` (${entry.time})` : ''}`);
}
