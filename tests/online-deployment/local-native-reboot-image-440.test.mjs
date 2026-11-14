import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('backend image includes both reviewed local reboot policies at the runtime script path', () => {
  const dockerfile = readFileSync(new URL('../../backend/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile,
    /^COPY deploy\/scripts\/backend-runtime-owner\.py deploy\/scripts\/local-native-reboot\.py deploy\/scripts\/local-native-reboot-440\.py .* \.\/scripts\/$/m);
});
