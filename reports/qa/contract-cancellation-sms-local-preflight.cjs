const { spawnSync } = require('node:child_process');
const result = spawnSync('docker', ['compose', '-f', 'docker-compose.local.yml', 'ps', '--format', 'json'], {
  cwd: process.cwd(), encoding: 'utf8', timeout: 20000,
});
if (result.error || result.status !== 0) {
  console.error(JSON.stringify({ project: 'sabalanerp-local', status: 'unavailable',
    code: result.error?.code || result.status, detail: result.error?.message || result.stderr.trim() }));
  process.exit(1);
}
console.log(result.stdout);
