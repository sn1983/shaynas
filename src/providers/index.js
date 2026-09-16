import { createTwilioProvider } from './twilio.js';
import { createInforuProvider } from './inforu.js';
import { createSms4FreeProvider } from './sms4free.js';
import { createConsoleProvider } from './console.js';

const FACTORIES = {
  twilio: createTwilioProvider,
  inforu: createInforuProvider,
  sms4free: createSms4FreeProvider,
  console: createConsoleProvider,
};

export const providerNames = Object.keys(FACTORIES);

export function createProvider(name, env = process.env) {
  const factory = FACTORIES[name];
  if (!factory) {
    throw new Error(`Unknown SMS provider "${name}". Available: ${providerNames.join(', ')}.`);
  }
  return factory(env);
}
