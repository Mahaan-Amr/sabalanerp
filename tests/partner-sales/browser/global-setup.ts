import { preflight } from '../harness/safety.mjs';

export default async function globalSetup() {
  await preflight(); // Direct Playwright invocation cannot bypass runtime safety.
}
