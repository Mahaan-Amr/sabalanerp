import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Bind evidence to uncommitted and newly added relevant files as well as the commit.
export const performanceSourceHash = async () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    'backend/src', 'backend/prisma', 'frontend/src', 'packages', 'scripts', 'deploy', '.github',
    'docs/operations', 'docs/adr', 'AGENTS.md', 'CONTEXT.md', '*package*.json', '*Dockerfile*', 'docker-compose*.yml',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of [...new Set(files)]) {
    hash.update(file); hash.update('\0');
    try { hash.update(await readFile(file)); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('DELETED');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
};
