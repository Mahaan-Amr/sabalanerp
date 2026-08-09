import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const compose = ['compose', '-f', 'docker-compose.local.yml'];
const updateBaselines = process.argv.includes('--update-baselines');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status || 1);
};

run('docker', [...compose, 'ps']);
run('docker', [...compose, 'up', '--build', '-d', '--wait', 'backend']);
run('docker', [...compose, 'exec', '-T', 'backend', 'node', 'dist/scripts/verifyDispatchDocumentPdfs.js', ...(updateBaselines ? ['--update-baselines'] : [])]);

const container = spawnSync('docker', [...compose, 'ps', '-q', 'backend'], { cwd: root, encoding: 'utf8' });
if (container.status !== 0 || !container.stdout.trim()) throw new Error('sabalanerp-local backend container was not found');

const qaTarget = path.join(root, 'tmp', 'dispatch-document-pdf-qa');
fs.rmSync(qaTarget, { recursive: true, force: true });
fs.mkdirSync(path.dirname(qaTarget), { recursive: true });
run('docker', ['cp', `${container.stdout.trim()}:/app/tmp/dispatch-document-pdf-qa`, qaTarget]);

if (updateBaselines) {
  const baselineTarget = path.join(root, 'backend', 'src', 'documents', 'dispatch', '__fixtures__', 'baselines');
  fs.rmSync(baselineTarget, { recursive: true, force: true });
  fs.mkdirSync(baselineTarget, { recursive: true });
  run('docker', ['cp', `${container.stdout.trim()}:/app/dispatch-document-baselines/.`, baselineTarget]);
}

console.log(`sabalanerp-local dispatch PDF QA artifacts: ${qaTarget}`);
