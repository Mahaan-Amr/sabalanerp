import { spawnSync } from 'node:child_process';

// Reuses the approved local stack; never creates a second Compose project.
for (const args of [
  ['compose', '-f', 'docker-compose.local.yml', 'ps'],
  ['compose', '-f', 'docker-compose.local.yml', 'build', 'frontend'],
  ['compose', '-f', 'docker-compose.local.yml', 'ps'],
  ['compose', '-f', 'docker-compose.local.yml', 'up', '-d', '--no-build', '--no-deps', '--wait', 'frontend'],
]) {
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Open an existing customer account with ?variant=A, ?variant=B or ?variant=C.');
