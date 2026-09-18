export function parseDuration(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(String(value).trim());
  if (!match) throw new Error(`cannot read duration "${value}" (try 45s, 5m, 1h)`);
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const factor = { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit];
  return Math.round(amount * factor);
}

/** Parses "--flag", "--key=value" and "--key value" into an object. */
export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (!argument.startsWith('--')) continue;
    const body = argument.slice(2);
    const equals = body.indexOf('=');
    if (equals !== -1) {
      options[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[body] = next;
      i += 1;
    } else {
      options[body] = true;
    }
  }
  return options;
}

export const isTrue = (value) => value === true || /^(1|true|yes|on)$/i.test(String(value ?? ''));
