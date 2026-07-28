import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitDirectory = path.join(repositoryRoot, '.git');

if (!fs.existsSync(gitDirectory)) {
  process.stdout.write('No Git worktree detected; Sabalan Design System hooks were not configured.\n');
  process.exit(0);
}

const result = spawnSync(
  'git',
  ['config', '--local', 'core.hooksPath', '.githooks'],
  { cwd: repositoryRoot, encoding: 'utf8' }
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || 'Unable to configure repository Git hooks.\n');
  process.exit(result.status ?? 1);
}

process.stdout.write('Configured Sabalan Design System pre-commit gates.\n');
