const API_BASE = 'https://api.twilio.com/2010-04-01';

export function createTwilioProvider(env = process.env) {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM;
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken) {
    throw new Error('Twilio provider requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
  }
  if (!from && !messagingServiceSid) {
    throw new Error('Twilio provider requires TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID.');
  }

  return {
    name: 'twilio',
    async send({ to, body }) {
      const params = new URLSearchParams({ To: to, Body: body });
      if (messagingServiceSid) params.set('MessagingServiceSid', messagingServiceSid);
      else params.set('From', from);

      const response = await fetch(`${API_BASE}/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`Twilio rejected the message (${response.status}): ${payload.message ?? 'unknown error'}`);
      }
      return { id: payload.sid };
    },
  };
}
