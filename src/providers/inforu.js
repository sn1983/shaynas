const API_URL = 'https://uapi.inforu.co.il/api/v2/SMS/SendSms';

/** Inforu (Israeli gateway) — phone numbers go out in local 05x format. */
function toLocalIsraeliFormat(phone) {
  return phone.startsWith('+972') ? `0${phone.slice(4)}` : phone;
}

export function createInforuProvider(env = process.env) {
  const username = env.INFORU_USERNAME;
  const token = env.INFORU_TOKEN;
  const sender = env.INFORU_SENDER;

  if (!username || !token || !sender) {
    throw new Error('Inforu provider requires INFORU_USERNAME, INFORU_TOKEN and INFORU_SENDER.');
  }

  return {
    name: 'inforu',
    async send({ to, body }) {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Data: {
            Message: body,
            Recipients: [{ Phone: toLocalIsraeliFormat(to) }],
            Settings: { Sender: sender },
          },
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.StatusId !== 1) {
        const detail = payload.StatusDescription ?? payload.DetailedDescription ?? 'unknown error';
        throw new Error(`Inforu rejected the message (${response.status}): ${detail}`);
      }
      return { id: payload.Data?.BatchId ?? null };
    },
  };
}
