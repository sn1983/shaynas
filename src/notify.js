import * as consoleNotifier from './notifiers/console.js';
import * as ntfy from './notifiers/ntfy.js';
import * as pushover from './notifiers/pushover.js';
import * as telegram from './notifiers/telegram.js';
import * as webhook from './notifiers/webhook.js';

const NOTIFIERS = [consoleNotifier, telegram, pushover, ntfy, webhook];

export function notifierNames() {
  return NOTIFIERS.map((notifier) => notifier.name);
}

export function formatMessage(entry, { listenUrl } = {}) {
  const artist = entry.artist || entry.match?.artist || '';
  const lines = [];
  if (entry.title) lines.push(`🎵 ${entry.title}`);
  if (entry.time) lines.push(`🕒 ${entry.time}`);
  if (!entry.structured) lines.push(entry.raw.slice(0, 200));
  if (listenUrl) lines.push(listenUrl);
  return {
    title: `🎧 ${artist || entry.match?.artist} מתנגנים עכשיו בגלגלצ`,
    body: lines.join('\n'),
    song: { artist, title: entry.title, time: entry.time },
  };
}

/**
 * Sends one message through every selected channel. A channel that fails does
 * not stop the others - missing a notification on one phone is better than
 * losing all of them.
 */
export async function notifyAll(message, { selected, env = process.env, dryRun = false } = {}) {
  const wanted = dryRun ? ['console'] : selected;
  const results = [];
  for (const name of wanted) {
    const notifier = NOTIFIERS.find((candidate) => candidate.name === name);
    if (!notifier) {
      results.push({ name, ok: false, error: `unknown notifier (have: ${notifierNames().join(', ')})` });
      continue;
    }
    if (!notifier.configured(env)) {
      results.push({ name, ok: false, error: 'missing configuration - see .env.example' });
      continue;
    }
    try {
      await notifier.send(message, env);
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    }
  }
  return results;
}
