import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  recipients: join(rootDir, 'config', 'recipients.json'),
  recipientsExample: join(rootDir, 'config', 'recipients.example.json'),
  messages: join(rootDir, 'config', 'messages.json'),
};

const DEFAULTS = {
  timezone: 'Asia/Jerusalem',
  sendAtHour: 7,
  sendAtMinute: 0,
  skipDays: [],
};

/**
 * Recipients can also come from an env var (RECIPIENTS_JSON), which is how the
 * GitHub Actions workflow keeps the phone numbers out of the repository.
 */
async function readRecipientsSource() {
  if (process.env.RECIPIENTS_JSON) {
    return { source: 'RECIPIENTS_JSON', raw: process.env.RECIPIENTS_JSON };
  }
  if (existsSync(paths.recipients)) {
    return { source: paths.recipients, raw: await readFile(paths.recipients, 'utf8') };
  }
  throw new Error(
    'No recipients configured. Copy config/recipients.example.json to ' +
      'config/recipients.json, or set the RECIPIENTS_JSON environment variable.',
  );
}

export function normalizePhone(phone, defaultCountryCode = '+972') {
  const trimmed = String(phone ?? '').replace(/[\s\-()]/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2)}`;
  if (trimmed.startsWith('0')) return `${defaultCountryCode}${trimmed.slice(1)}`;
  return `+${trimmed}`;
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Recipients config must be a JSON object.');
  }
  if (!Array.isArray(config.recipients) || config.recipients.length === 0) {
    throw new Error('Recipients config must contain a non-empty "recipients" array.');
  }

  const merged = { ...DEFAULTS, ...config };
  const defaultCountryCode = merged.defaultCountryCode ?? '+972';

  merged.recipients = config.recipients.map((recipient, index) => {
    if (!recipient?.name) throw new Error(`Recipient #${index + 1} is missing "name".`);
    if (!recipient?.phone) throw new Error(`Recipient "${recipient.name}" is missing "phone".`);

    const phone = normalizePhone(recipient.phone, defaultCountryCode);
    if (!/^\+\d{8,15}$/.test(phone)) {
      throw new Error(`Recipient "${recipient.name}" has an invalid phone number: ${recipient.phone}`);
    }

    return { ...recipient, phone, enabled: recipient.enabled !== false };
  });

  return merged;
}

export async function loadConfig() {
  const { source, raw } = await readRecipientsSource();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not parse recipients config from ${source}: ${error.message}`);
  }
  return validateConfig(parsed);
}

export async function loadMessages() {
  const raw = await readFile(paths.messages, 'utf8');
  const messages = JSON.parse(raw);
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('config/messages.json must contain a non-empty array of messages.');
  }
  return messages;
}
