import { postForm } from '../http.js';

export const name = 'pushover';

export function configured(env) {
  return Boolean(env.PUSHOVER_TOKEN && env.PUSHOVER_USER);
}

export async function send(message, env) {
  await postForm('https://api.pushover.net/1/messages.json', {
    token: env.PUSHOVER_TOKEN,
    user: env.PUSHOVER_USER,
    title: message.title,
    message: message.body,
  });
}
