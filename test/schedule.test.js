import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSendNow, localParts, dateKey } from '../src/schedule.js';

const config = {
  timezone: 'Asia/Jerusalem',
  sendAtHour: 7,
  sendAtMinute: 0,
  skipDays: [],
};

test('during DST the 04:00 UTC run is the one that sends', () => {
  // 2026-07-15 is in Israeli DST (UTC+3).
  assert.equal(shouldSendNow(new Date('2026-07-15T04:00:00Z'), config).send, true);
  assert.equal(shouldSendNow(new Date('2026-07-15T05:00:00Z'), config).send, false);
});

test('during standard time the 05:00 UTC run is the one that sends', () => {
  // 2026-01-15 is Israeli standard time (UTC+2).
  assert.equal(shouldSendNow(new Date('2026-01-15T04:00:00Z'), config).send, false);
  assert.equal(shouldSendNow(new Date('2026-01-15T05:00:00Z'), config).send, true);
});

test('exactly one send per day across a full year of both cron runs', () => {
  let sendingDays = 0;
  for (let day = 0; day < 365; day += 1) {
    const base = Date.UTC(2026, 0, 1) + day * 24 * 60 * 60 * 1000;
    const runs = [
      new Date(base + 4 * 60 * 60 * 1000),
      new Date(base + 5 * 60 * 60 * 1000),
    ];
    const sends = runs.filter((run) => shouldSendNow(run, config).send);
    assert.equal(sends.length, 1, `expected one send on day ${day}, got ${sends.length}`);
    sendingDays += sends.length;
  }
  assert.equal(sendingDays, 365);
});

test('a delayed runner still sends inside the tolerance window', () => {
  assert.equal(shouldSendNow(new Date('2026-07-15T04:40:00Z'), config).send, true);
  assert.equal(shouldSendNow(new Date('2026-07-15T04:46:00Z'), config).send, false);
});

test('skipDays keeps the message from going out', () => {
  const saturdayOff = { ...config, skipDays: ['saturday'] };
  // 2026-07-18 is a Saturday.
  const decision = shouldSendNow(new Date('2026-07-18T04:00:00Z'), saturdayOff);
  assert.equal(decision.send, false);
  assert.match(decision.reason, /skipDays/);
});

test('localParts renders midnight as hour 0', () => {
  assert.equal(localParts(new Date('2026-07-14T21:00:00Z'), 'Asia/Jerusalem').hour, 0);
});

test('dateKey uses the local calendar day', () => {
  assert.equal(dateKey(new Date('2026-07-14T21:30:00Z'), 'Asia/Jerusalem'), '2026-07-15');
});
