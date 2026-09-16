import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadConfig, loadMessages } from './config.js';
import { shouldSendNow, dateKey } from './schedule.js';
import { buildMessages } from './messages.js';
import { createProvider } from './providers/index.js';

const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      only: { type: 'string' },
      provider: { type: 'string' },
      tolerance: { type: 'string' },
    },
  });
  return values;
}

function parseTolerance(value) {
  if (value === undefined) return undefined;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`--tolerance must be a non-negative number of minutes, got "${value}".`);
  }
  // Above 60 minutes both cron runs could fall inside the window and send twice.
  if (minutes >= 60) {
    throw new Error('--tolerance must stay below 60 minutes to avoid a double send.');
  }
  return minutes;
}

async function sendWithRetry(provider, message) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await provider.send({ to: message.phone, body: message.body });
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = 2000 * 2 ** (attempt - 1);
        console.warn(`  retry ${attempt}/${MAX_ATTEMPTS - 1} for ${message.name}: ${error.message}`);
        await sleep(backoffMs);
      }
    }
  }
  throw lastError;
}

export async function run(argv = process.argv.slice(2), env = process.env, now = new Date()) {
  const args = parseCliArgs(argv);
  const config = await loadConfig();
  const defaultMessages = await loadMessages();

  if (!args.force) {
    const decision = shouldSendNow(now, config, parseTolerance(args.tolerance));
    if (!decision.send) {
      console.log(`Not sending: ${decision.reason}.`);
      return { sent: 0, failed: 0, skipped: true };
    }
  }

  const today = dateKey(now, config.timezone);
  let messages = buildMessages(config, defaultMessages, today);

  if (args.only) {
    const wanted = args.only.toLowerCase();
    messages = messages.filter((message) => message.name.toLowerCase() === wanted);
    if (messages.length === 0) {
      throw new Error(`No enabled recipient named "${args.only}".`);
    }
  }

  if (messages.length === 0) {
    console.log('Not sending: no enabled recipients.');
    return { sent: 0, failed: 0, skipped: true };
  }

  const providerName = args['dry-run'] ? 'console' : (args.provider ?? env.SMS_PROVIDER ?? 'twilio');
  const provider = createProvider(providerName, env);

  console.log(`Sending ${messages.length} message(s) for ${today} via ${provider.name}.`);

  let sent = 0;
  const failures = [];
  for (const message of messages) {
    try {
      const result = await sendWithRetry(provider, message);
      sent += 1;
      console.log(`  sent to ${message.name} (${message.phone})${result?.id ? ` id=${result.id}` : ''}`);
    } catch (error) {
      // One bad number must not stop the other kids from getting their message.
      failures.push({ name: message.name, error });
      console.error(`  FAILED for ${message.name} (${message.phone}): ${error.message}`);
    }
  }

  console.log(`Done: ${sent} sent, ${failures.length} failed.`);
  return { sent, failed: failures.length, skipped: false, failures };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const result = await run();
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
