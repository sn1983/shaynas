import { postJson } from '../http.js';

export const name = 'webhook';

export function configured(env) {
  return Boolean(env.NOTIFY_WEBHOOK_URL);
}

export async function send(message, env) {
  // "text" and "content" cover Slack and Discord incoming webhooks; the song
  // fields are there for anything else on the receiving end.
  await postJson(env.NOTIFY_WEBHOOK_URL, {
    text: `${message.title}\n${message.body}`,
    content: `${message.title}\n${message.body}`,
    title: message.title,
    body: message.body,
    song: message.song,
  });
}
