#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const inputFile = option('--input');
const outputFile = option('--output');
if (!inputFile || !outputFile || args.length !== 4) {
  process.stderr.write('usage: node scripts/qualify-accounting-production-state.mjs --input private-requests.json --output private-receipt.json\n');
  process.exit(2);
}

const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`, 'i').test(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value);
const percentile = (sorted, fraction) => sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
const summarize = requests => {
  const durations = requests.map(r => r?.durationMs).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  return {
    count: requests.length,
    coldCount: requests.filter(r => r?.phase === 'cold').length,
    warmCount: requests.filter(r => r?.phase === 'warm').length,
    p50Ms: percentile(durations, .50), p95Ms: percentile(durations, .95),
    p99Ms: percentile(durations, .99), maxMs: durations.at(-1) ?? null,
    errorCount: requests.filter(r => r?.status !== 200 || r?.errorCode !== undefined).length,
    p2024Count: requests.filter(r => r?.errorCode === 'P2024').length,
    p2028Count: requests.filter(r => r?.errorCode === 'P2028').length,
    durationsMs: durations,
  };
};

let source;
let data;
try { source = readFileSync(inputFile); data = JSON.parse(source); }
catch { process.stderr.write('Cannot read valid request input.\n'); process.exit(2); }

const reasons = [];
if (data?.format !== 'sabalan-accounting-production-state-requests/v1') reasons.push('Unknown input format');
if (data?.provenance?.kind !== 'protected-production-state-recovery-copy' || data.provenance.privateIngress !== true || !hex(data.provenance.recoveryManifestSha256, 64) || !hex(data.provenance.populationEvidenceSha256, 64) || !data.provenance.evidenceRef || !data.provenance.workloadSource) reasons.push('Protected production-state provenance incomplete');
if (!hex(data?.candidate?.commit, 40) || !hex(data?.candidate?.tree, 40) || !digest(data?.candidate?.backendImage) || !digest(data?.candidate?.frontendImage)) reasons.push('Candidate source or immutable image identity incomplete');
const w = data?.workload;
const population = data?.provenance?.sourcePopulation;
if (w?.actorClass !== 'authorized-accountant' || !hex(w.actorSha256, 64) || !Number.isSafeInteger(w.ordinaryContracts) || w.ordinaryContracts < 0 || !Number.isSafeInteger(w.committedPartnerCases) || w.committedPartnerCases < 0 || !Number.isSafeInteger(population?.ordinaryContracts) || population.ordinaryContracts < 0 || !Number.isSafeInteger(population?.committedPartnerCases) || population.committedPartnerCases < 0 || w.ordinaryContracts !== population.ordinaryContracts || w.committedPartnerCases !== population.committedPartnerCases || w.ordinaryContracts + w.committedPartnerCases < 1 || !Number.isSafeInteger(w.concurrency) || w.concurrency < 1 || !Number.isSafeInteger(w.pageSize) || w.pageSize < 1 || !Array.isArray(w.filters) || !w.filters.includes('reviewable') || w.observation !== 'full HTTP responses' || w.endpoints?.dashboard !== '/api/accounting/dashboard' || w.endpoints?.['reviewable-list'] !== '/api/accounting/contracts?view=reviewable') reasons.push('Workload shape or measured production-copy population invalid');
if (!Array.isArray(data?.requests)) reasons.push('Request records missing');
const requests = Array.isArray(data?.requests) ? data.requests : [];
const ids = new Set();
for (const r of requests) {
  if (!['dashboard', 'reviewable-list'].includes(r?.surface) || !Number.isFinite(r?.durationMs) || r.durationMs < 0 || !Number.isInteger(r?.status) || typeof r?.requestId !== 'string' || !r.requestId || !['cold', 'warm'].includes(r.phase) || (r.errorCode !== undefined && (typeof r.errorCode !== 'string' || !r.errorCode.trim()))) reasons.push('Invalid request record');
  if (ids.has(r?.requestId)) reasons.push('Duplicate request ID');
  ids.add(r?.requestId);
}
const surfaces = Object.fromEntries(['dashboard', 'reviewable-list'].map(name => [name, summarize(requests.filter(r => r?.surface === name))]));
for (const [name, result] of Object.entries(surfaces)) {
  if (result.count < 20 || result.coldCount < 1 || result.warmCount < 1) reasons.push(`${name}: at least 20 complete samples including cold and warm required`);
  if (result.p95Ms === null || result.p95Ms >= 3000) reasons.push(`${name}: p95 must be below 3000 ms`);
  if (result.errorCount !== 0) reasons.push(`${name}: request errors present`);
  if (result.p2028Count !== 0) reasons.push(`${name}: P2028 present`);
}
const receipt = {
  format: 'sabalan-accounting-production-state-measurement/v1',
  decision: reasons.length ? 'MEASUREMENT_FAIL' : 'MEASUREMENT_PASS_ONLY',
  reasons: [...new Set(reasons)],
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  provenance: { kind: data?.provenance?.kind, recoveryManifestSha256: data?.provenance?.recoveryManifestSha256, populationEvidenceSha256: data?.provenance?.populationEvidenceSha256, sourcePopulation: population, privateIngress: data?.provenance?.privateIngress, evidenceRef: data?.provenance?.evidenceRef, workloadSource: data?.provenance?.workloadSource },
  candidate: { commit: data?.candidate?.commit, tree: data?.candidate?.tree, backendImage: data?.candidate?.backendImage, frontendImage: data?.candidate?.frontendImage },
  workload: { actorClass: w?.actorClass, actorSha256: w?.actorSha256, ordinaryContracts: w?.ordinaryContracts, committedPartnerCases: w?.committedPartnerCases, concurrency: w?.concurrency, filters: w?.filters, pageSize: w?.pageSize, observation: w?.observation, endpoints: w?.endpoints },
  surfaces,
  note: 'Measurement only. Provenance, correctness, native owner, checkpoint, rollback, and complete release gates require independent verification.',
};
writeFileSync(outputFile, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
process.stdout.write(`${receipt.decision}: ${outputFile}\n`);
process.exit(reasons.length ? 2 : 0);
