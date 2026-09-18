export const name = 'console';

export function configured() {
  return true;
}

export async function send(message) {
  console.log(`\n${message.title}\n${message.body}\n`);
}
