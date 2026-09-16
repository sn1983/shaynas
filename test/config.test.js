import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, validateConfig } from '../src/config.js';

test('local Israeli numbers become E.164', () => {
  assert.equal(normalizePhone('050-123-4567'), '+972501234567');
  assert.equal(normalizePhone('052 123 4567'), '+972521234567');
  assert.equal(normalizePhone('00972501234567'), '+972501234567');
  assert.equal(normalizePhone('+972501234567'), '+972501234567');
});

test('validateConfig fills in the defaults', () => {
  const config = validateConfig({ recipients: [{ name: 'נועה', phone: '0501234567' }] });
  assert.equal(config.timezone, 'Asia/Jerusalem');
  assert.equal(config.sendAtHour, 7);
  assert.equal(config.recipients[0].phone, '+972501234567');
  assert.equal(config.recipients[0].enabled, true);
});

test('a malformed phone number is rejected', () => {
  assert.throws(
    () => validateConfig({ recipients: [{ name: 'נועה', phone: '12' }] }),
    /invalid phone number/,
  );
});

test('an empty recipients list is rejected', () => {
  assert.throws(() => validateConfig({ recipients: [] }), /non-empty "recipients" array/);
});
