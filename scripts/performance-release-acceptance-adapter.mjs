import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { canonicalPerformanceEvidence as canonical } from './performance-evidence-canonical.mjs';
import { performanceSourceHash } from './performance-source-identity.mjs';
import { capturePerformanceRuntimeSourceBinding } from './performance-runtime-source-binding.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const requiredPath = (name) => {
  const value = process.env[name]?.trim();
  if (!value || !path.isAbsolute(value)) throw new Error(`${name}_REQUIRED`);
  return value;
};
const candidate = requiredPath('PERFORMANCE_ACCEPTANCE_CANDIDATE_PATH');
const report = requiredPath('PERFORMANCE_ACCEPTANCE_LOCAL_REPORT_PATH');
const review = requiredPath('PERFORMANCE_ACCEPTANCE_REVIEW_PATH');
const node = process.execPath;
const script = (name) => path.join(repositoryRoot, 'scripts', name);
const verifiedCandidateIdentity = async () => {
  const identity = JSON.parse(await readFile(candidate, 'utf8'));
  const current = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
    sourceHash: await performanceSourceHash(),
  };
  if (identity.commit !== current.commit || identity.sourceHash !== current.sourceHash) {
    throw new Error('ACCEPTANCE_CANDIDATE_SOURCE_CHANGED');
  }
  const runtime = capturePerformanceRuntimeSourceBinding(current);
  if (canonical(identity.images) !== canonical(runtime.images)) {
    throw new Error('ACCEPTANCE_CANDIDATE_RUNTIME_CHANGED');
  }
  return identity;
};

export const performanceAcceptanceAdapter = {
  identity: verifiedCandidateIdentity,
  checks: [
    { name: 'integrated-regression', command: node,
      args: [script('run-performance-integrated-acceptance.mjs'), '--identity', candidate, '--report', report, '--review', review],
      cwd: repositoryRoot, timeoutMs: 5 * 60_000 },
    { name: 'twelve-races', command: node,
      args: [script('run-performance-race-acceptance.mjs'), 'release', '--identity', candidate],
      cwd: repositoryRoot, timeoutMs: 3 * 60 * 60_000 },
    { name: 'failure-recovery', command: node,
      args: [script('run-performance-failure-recovery-acceptance.mjs'), '--identity', candidate],
      cwd: repositoryRoot, timeoutMs: 2 * 60 * 60_000 },
    { name: 'permission-nondisclosure', command: node,
      args: [script('run-performance-permission-acceptance.mjs'), '--identity', candidate, '--review', review],
      cwd: repositoryRoot, timeoutMs: 60 * 60_000 },
    { name: 'browser-matrix', command: node,
      args: [script('run-performance-browser-acceptance.mjs'), '--identity', candidate],
      cwd: repositoryRoot, timeoutMs: 20 * 60_000 },
    { name: 'export-capacity', command: node,
      args: [script('run-performance-export-capacity-acceptance.mjs'), '--identity', candidate],
      cwd: repositoryRoot, timeoutMs: 30 * 60_000 },
  ],
};
