const API_URL = 'https://api.sms4free.co.il/ApiSMS/v2/SendSMS';

function toLocalIsraeliFormat(phone) {
  return phone.startsWith('+972') ? `0${phone.slice(4)}` : phone;
}

export function createSms4FreeProvider(env = process.env) {
  const key = env.SMS4FREE_KEY;
  const user = env.SMS4FREE_USER;
  const pass = env.SMS4FREE_PASS;
  const sender = env.SMS4FREE_SENDER;

  if (!key || !user || !pass || !sender) {
    throw new Error(
      'SMS4Free provider requires SMS4FREE_KEY, SMS4FREE_USER, SMS4FREE_PASS and SMS4FREE_SENDER.',
    );
  }

  return {
    name: 'sms4free',
    async send({ to, body }) {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          user,
          pass,
          sender,
          recipient: toLocalIsraeliFormat(to),
          msg: body,
        }),
      });

      const text = await response.text();
      // The API answers with a bare number: positive = messages sent, otherwise an error code.
      const status = Number(text.trim());
      if (!response.ok || !Number.isFinite(status) || status <= 0) {
        throw new Error(`SMS4Free rejected the message (${response.status}): ${text.trim()}`);
      }
      return { id: null };
    },
  };
}
