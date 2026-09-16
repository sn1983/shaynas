import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMessage, buildMessages, renderTemplate } from '../src/messages.js';

const pool = ['בוקר טוב {name} א', 'בוקר טוב {name} ב', 'בוקר טוב {name} ג'];

test('the name is substituted into the template', () => {
  assert.equal(renderTemplate('בוקר טוב {name}!', { name: 'נועה' }), 'בוקר טוב נועה!');
});

test('the same day always yields the same message', () => {
  const recipient = { name: 'נועה' };
  assert.equal(pickMessage(recipient, pool, '2026-07-15'), pickMessage(recipient, pool, '2026-07-15'));
});

test('consecutive days rotate through the pool', () => {
  const recipient = { name: 'נועה' };
  const picks = ['2026-07-15', '2026-07-16', '2026-07-17'].map((day) =>
    pickMessage(recipient, pool, day),
  );
  assert.equal(new Set(picks).size, 3);
});

test('a per-recipient message list overrides the shared pool', () => {
  const recipient = { name: 'איתי', messages: ['רק בשבילך {name}'] };
  assert.equal(pickMessage(recipient, pool, '2026-07-15'), 'רק בשבילך איתי');
});

test('disabled recipients are left out', () => {
  const config = {
    recipients: [
      { name: 'נועה', phone: '+972501234567', enabled: true },
      { name: 'איתי', phone: '+972521234567', enabled: false },
    ],
  };
  const messages = buildMessages(config, pool, '2026-07-15');
  assert.deepEqual(messages.map((message) => message.name), ['נועה']);
});
