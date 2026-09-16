const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Wall-clock parts of `date` in `timezone`. Going through Intl means the DST
 * switches in Israel (and anywhere else) are handled for us: the scheduler runs
 * on UTC cron, and this is what decides whether it is really 07:00 locally.
 */
export function localParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" in some ICU versions.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: parts.weekday.toLowerCase(),
  };
}

export function dateKey(date, timezone) {
  const { year, month, day } = localParts(date, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isSkippedDay(weekday, skipDays) {
  return (skipDays ?? []).some((entry) => {
    if (typeof entry === 'number') return WEEKDAY_NAMES[entry] === weekday;
    return String(entry).toLowerCase() === weekday;
  });
}

/**
 * The cron trigger fires on a UTC schedule that brackets 07:00 local time, so
 * every run asks this whether it is the one that should actually send.
 * `toleranceMinutes` absorbs the queueing delay of hosted runners.
 */
export function shouldSendNow(now, config, toleranceMinutes = 45) {
  const { timezone, sendAtHour, sendAtMinute, skipDays } = config;
  const parts = localParts(now, timezone);

  if (isSkippedDay(parts.weekday, skipDays)) {
    return { send: false, reason: `${parts.weekday} is in skipDays`, parts };
  }

  const nowMinutes = parts.hour * 60 + parts.minute;
  const targetMinutes = sendAtHour * 60 + sendAtMinute;
  const delta = nowMinutes - targetMinutes;

  if (delta < 0) {
    return {
      send: false,
      reason: `local time is ${formatClock(parts)}, before the ${formatTarget(config)} send window`,
      parts,
    };
  }
  if (delta > toleranceMinutes) {
    return {
      send: false,
      reason: `local time is ${formatClock(parts)}, past the ${formatTarget(config)} send window`,
      parts,
    };
  }

  return { send: true, reason: `local time is ${formatClock(parts)}`, parts };
}

function formatClock({ hour, minute }) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatTarget({ sendAtHour, sendAtMinute }) {
  return formatClock({ hour: sendAtHour, minute: sendAtMinute });
}

export { WEEKDAY_NAMES };
