import { spawnSync } from 'node:child_process';
const ps = spawnSync('docker', ['compose', '-f', 'docker-compose.local.yml', 'ps', '--status', 'running', '--services'], { encoding: 'utf8' });
if (ps.status !== 0 || !ps.stdout.split(/\s+/).includes('postgres')) throw new Error('Existing sabalanerp-local postgres is required.');
for (const args of [
  [process.execPath, ['--test', 'tests/attendance-connector/read-only-surface.test.mjs']],
  [process.execPath, ['backend/node_modules/tsx/dist/cli.mjs', '--test', '--test-concurrency=1', 'backend/src/services/__tests__/attendanceDevice.integration.test.ts', 'backend/src/services/__tests__/attendanceDeviceHttp.integration.test.ts']],
]) {
  const r = spawnSync(args[0], args[1], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=6&pool_timeout=10' } });
  if (r.status !== 0) process.exit(r.status || 1);
}
