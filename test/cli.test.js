import assert from 'node:assert/strict';
import test from 'node:test';
import { isTrue, parseArgs, parseDuration } from '../src/cli.js';

test('parses flags, --key=value and --key value', () => {
  assert.deepEqual(parseArgs(['--watch', '--interval', '30s', '--duration=5m', '--dry-run']), {
    watch: true, interval: '30s', duration: '5m', 'dry-run': true,
  });
});

test('reads durations with and without a unit', () => {
  assert.equal(parseDuration('45s'), 45000);
  assert.equal(parseDuration('5m'), 300000);
  assert.equal(parseDuration('1h'), 3600000);
  assert.equal(parseDuration('90'), 90000);
  assert.equal(parseDuration(undefined, 1234), 1234);
  assert.throws(() => parseDuration('soon'), /cannot read duration/);
});

test('reads truthy strings', () => {
  assert.ok(isTrue('true') && isTrue('1') && isTrue(true) && isTrue('yes'));
  assert.ok(!isTrue('false') && !isTrue('') && !isTrue(undefined));
});
