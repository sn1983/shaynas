const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSinceEpoch(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / MS_PER_DAY);
}

function nameOffset(name) {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.codePointAt(0)) % 100000;
  }
  return hash;
}

export function renderTemplate(template, recipient) {
  return template.replaceAll('{name}', recipient.name);
}

/**
 * Deterministic rotation rather than a random pick: the same day always
 * produces the same text (so a retry cannot send a different message), and
 * consecutive days always move through the pool instead of repeating.
 * The per-name offset keeps siblings from getting identical wording.
 */
export function pickMessage(recipient, defaultMessages, dateKey) {
  const pool = recipient.messages?.length ? recipient.messages : defaultMessages;
  if (!pool?.length) {
    throw new Error(`No messages available for "${recipient.name}".`);
  }
  const index = (daysSinceEpoch(dateKey) + nameOffset(recipient.name)) % pool.length;
  return renderTemplate(pool[index], recipient);
}

export function buildMessages(config, defaultMessages, dateKey) {
  return config.recipients
    .filter((recipient) => recipient.enabled)
    .map((recipient) => ({
      name: recipient.name,
      phone: recipient.phone,
      body: pickMessage(recipient, defaultMessages, dateKey),
    }));
}
