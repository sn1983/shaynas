import { readFile } from 'node:fs/promises';
import { notifierNames } from './notify.js';

export const DEFAULTS = {
  feedUrl: 'https://glzxml.blob.core.windows.net/dalet/glglz-onair/onair.xml',
  listenUrl: 'https://glz.co.il/glglz',
  pollSeconds: 45,
  dedupeMinutes: 30,
  artists: [{ name: 'Imagine Dragons', aliases: ['imagine dragon'] }],
};

function normalizeArtists(artists) {
  const list = (Array.isArray(artists) ? artists : [artists])
    .filter(Boolean)
    .map((artist) => (typeof artist === 'string' ? { name: artist } : artist))
    .filter((artist) => artist.name);
  if (list.length === 0) throw new Error('no artists to watch - check config/watchlist.json or ARTISTS');
  return list;
}

export async function loadConfig({ path, env = process.env, options = {} } = {}) {
  let fromFile = {};
  if (path) {
    try {
      fromFile = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`cannot read ${path}: ${error.message}`);
    }
  }

  const config = { ...DEFAULTS, ...fromFile };
  if (env.FEED_URL) config.feedUrl = env.FEED_URL;
  if (env.LISTEN_URL) config.listenUrl = env.LISTEN_URL;
  if (env.POLL_SECONDS) config.pollSeconds = Number(env.POLL_SECONDS);
  if (env.DEDUPE_MINUTES) config.dedupeMinutes = Number(env.DEDUPE_MINUTES);
  if (env.ARTISTS) config.artists = env.ARTISTS.split(',').map((name) => name.trim());
  if (options.artist) config.artists = String(options.artist).split(',').map((name) => name.trim());
  if (options.feed) config.feedUrl = String(options.feed);

  config.artists = normalizeArtists(config.artists);

  const selected = String(options.notifiers ?? env.NOTIFIERS ?? 'console')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const unknown = selected.filter((name) => !notifierNames().includes(name));
  if (unknown.length > 0) {
    throw new Error(`unknown notifier(s): ${unknown.join(', ')} - available: ${notifierNames().join(', ')}`);
  }
  config.notifiers = selected;

  return config;
}
