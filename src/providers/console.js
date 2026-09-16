/** Prints instead of sending — used by --dry-run and for local development. */
export function createConsoleProvider() {
  return {
    name: 'console',
    async send({ to, body }) {
      console.log(`  [dry-run] ${to}: ${body}`);
      return { id: 'dry-run' };
    },
  };
}
