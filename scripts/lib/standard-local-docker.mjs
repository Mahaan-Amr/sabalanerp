import { spawnSync } from 'node:child_process';

export const localCompose = ['compose', '-f', 'docker-compose.local.yml'];

export function assertStandardLocalStartup(compose, { cwd = process.cwd(), run = spawnSync } = {}) {
  // Compose resolves shell precedence, project .env files, and COMPOSE_ENV_FILES.
  // Keep its output private because it also contains unrelated environment values.
  const resolved = run('docker', [...compose, 'config', '--environment'], {
    cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (resolved.error || resolved.status !== 0) {
    throw new Error('Could not resolve the local Compose environment. Startup was blocked.');
  }
  if (/^LOCAL_INQUIRY_DATA_SUBPATH=[^\r\n]+/m.test(resolved.stdout) ||
      /^LOCAL_INQUIRY_RESTORED=1\r?$/m.test(resolved.stdout)) {
    throw new Error('Recovered Inquiry is selected. Follow docs/operations/local-inquiry-recovery.md to start the local project.');
  }
}

export function startStandardLocal(compose, upArgs, { cwd = process.cwd(), run = spawnSync } = {}) {
  assertStandardLocalStartup(compose, { cwd, run });
  for (const args of [[...localCompose, 'ps'], [...compose, 'up', ...upArgs]]) {
    const result = run('docker', args, { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}
