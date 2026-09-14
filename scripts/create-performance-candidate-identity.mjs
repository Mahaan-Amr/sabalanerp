import { createHash, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performanceCandidateSignerFromEnvironment } from './performance-acceptance-artifact.mjs';
import { canonicalPerformanceEvidence as canonical } from './performance-evidence-canonical.mjs';
import { performanceSourceHash } from './performance-source-identity.mjs';
import { verifyPerformanceRuntimeSourceBinding } from './performance-runtime-source-binding.mjs';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--report' || args[2] !== '--output') {
  console.error('Usage: node scripts/create-performance-candidate-identity.mjs --report /absolute/report.json --output /absolute/candidate.json');
  process.exit(2);
}

try {
  const reportBytes = await readFile(path.resolve(args[1]));
  const report = JSON.parse(reportBytes.toString('utf8'));
  if (report.status !== 'PASS' || report.blockers?.length || canonical(report.identity) !== canonical(report.finalIdentity)) {
    throw new Error('LOCAL_REPORT_NOT_STABLE_PASS');
  }
  const source = report.identity;
  if (source.runtimeSourceBinding?.status !== 'LIVE_IMAGE_IDENTITIES_MATCH_SOURCE'
    || !/^[a-f0-9]{64}$/.test(source.runtimeSourceBinding.evidenceHash)) {
    throw new Error('RUNTIME_SOURCE_BINDING_UNPROVEN');
  }
  const current = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceHash: await performanceSourceHash(),
  };
  if (source.commit !== current.commit || source.sourceHash !== current.sourceHash) {
    throw new Error('REPORT_SOURCE_CHANGED');
  }
  verifyPerformanceRuntimeSourceBinding(source, current);
  const release = {
    commit: source.commit,
    sourceHash: source.sourceHash,
    schemaHash: source.appliedMigrationHash,
    policyHash: source.policyMetadataHash,
    infrastructureHash: source.composeSourceHash,
    images: source.images,
  };
  const signer = performanceCandidateSignerFromEnvironment();
  if (!signer) throw new Error('CANDIDATE_SIGNER_UNAVAILABLE');
  const binding = { status: 'ATTESTED', evidenceHash: createHash('sha256').update(canonical({
    reportHash: createHash('sha256').update(reportBytes).digest('hex'), runtimeSourceBinding: source.runtimeSourceBinding,
  })).digest('hex'),
    keyId: signer.keyId, algorithm: 'Ed25519' };
  const identity = { ...release, runtimeSourceBinding: { ...binding,
    signature: sign(null, Buffer.from(canonical({ release, binding })), signer.privateKey).toString('base64') } };
  await writeFile(path.resolve(args[3]), `${JSON.stringify(identity, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'ATTESTED', candidate: path.resolve(args[3]), commit: identity.commit,
    evidenceHash: binding.evidenceHash, productionActivationAuthorized: false }));
} catch {
  console.error('Candidate identity creation failed closed; production activation is not authorized.');
  process.exitCode = 1;
}
