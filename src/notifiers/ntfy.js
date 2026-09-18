import { request } from '../http.js';

export const name = 'ntfy';

export function configured(env) {
  return Boolean(env.NTFY_TOPIC);
}

export async function send(message, env) {
  const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
  const headers = {
    title: encodeURIComponent(message.title),
    tags: 'musical_note',
  };
  if (env.NTFY_TOKEN) headers.authorization = `Bearer ${env.NTFY_TOKEN}`;
  await request(`${server}/${env.NTFY_TOPIC}`, {
    method: 'POST',
    headers,
    body: message.body,
  });
}
