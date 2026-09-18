import { postJson } from '../http.js';

export const name = 'telegram';

export function configured(env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

export async function send(message, env) {
  await postJson(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: `${message.title}\n${message.body}`,
    disable_web_page_preview: true,
  });
}
