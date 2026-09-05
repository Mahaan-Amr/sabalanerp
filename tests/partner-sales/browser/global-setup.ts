import { preflight } from '../harness/safety.mjs';

export default async function globalSetup() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  const database = url.pathname.slice(1);
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || !/^sabalanerp_partner_browser_[a-f0-9]{16}$/.test(database)) {
    throw new Error('Partner browser acceptance requires its isolated sabalanerp-local database.');
  }
  await preflight({ database }); // Direct Playwright invocation cannot bypass runtime safety.
}
