import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export const assertInquiryCheckoutMatchesGitlink = ({ recordedCommit, checkoutCommit, checkoutStatus }) => {
  if (!/^[a-f0-9]{40}$/.test(recordedCommit) || !/^[a-f0-9]{40}$/.test(checkoutCommit)) {
    throw new Error('INQUIRY_SOURCE_IDENTITY_UNAVAILABLE');
  }
  if (recordedCommit !== checkoutCommit) throw new Error('INQUIRY_CHECKOUT_COMMIT_MISMATCH');
  if (checkoutStatus.trim()) throw new Error('INQUIRY_CHECKOUT_DIRTY');
  return checkoutCommit;
};

// Bind evidence to uncommitted and newly added relevant files as well as the commit.
export const performanceSourceHash = async () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    'backend/src', 'backend/prisma', 'frontend/src', 'packages', 'scripts', 'deploy', '.github', 'tests',
    'backend/tsconfig.json', 'frontend/tsconfig.json', 'playwright*.config.*',
    'docs/operations', 'docs/adr', 'AGENTS.md', 'CONTEXT.md', '*package*.json', '*Dockerfile*', 'docker-compose*.yml',
    ':(exclude)**/node_modules',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  const inquiryCommit = assertInquiryCheckoutMatchesGitlink({
    recordedCommit: execFileSync('git', ['rev-parse', 'HEAD:apps/sabalan-inquiry'], { encoding: 'utf8' }).trim(),
    checkoutCommit: execFileSync('git', ['-C', 'apps/sabalan-inquiry', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    checkoutStatus: execFileSync('git', ['-C', 'apps/sabalan-inquiry', 'status', '--porcelain', '--untracked-files=all'],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }),
  });
  hash.update(JSON.stringify(['apps/sabalan-inquiry', 'GITLINK', inquiryCommit]));
  hash.update('\0');
  for (const file of [...new Set(files)]) {
    try {
      const contentHash = createHash('sha256').update(await readFile(file)).digest('hex');
      hash.update(JSON.stringify([file, 'PRESENT', contentHash]));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update(JSON.stringify([file, 'DELETED']));
    }
    hash.update('\0');
  }
  return hash.digest('hex');
};
