import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performanceMeasurementSignerFromEnvironment, signedPerformanceAcceptanceLane } from './performance-acceptance-artifact.mjs';
import { collectIntegratedRegressionMeasurements } from './performance-integrated-measurements.mjs';
import { canonicalPerformanceEvidence as canonical } from './performance-evidence-canonical.mjs';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const identityPath = value('--identity');
const reportPath = value('--report');
const reviewPath = value('--review');
if (args.length !== 6 || !identityPath || !reportPath || !reviewPath) {
  console.error('Usage: node scripts/run-performance-integrated-acceptance.mjs --identity candidate.json --report report.json --review review.json');
  process.exit(2);
}

try {
  const started = performance.now();
  const [identityBytes, reportBytes, reviewBytes] = await Promise.all([
    readFile(path.resolve(identityPath)), readFile(path.resolve(reportPath)), readFile(path.resolve(reviewPath)),
  ]);
  const identity = JSON.parse(identityBytes.toString('utf8'));
  const report = JSON.parse(reportBytes.toString('utf8'));
  const review = JSON.parse(reviewBytes.toString('utf8'));
  const source = report.identity;
  const releaseMatches = identity.commit === source?.commit && identity.sourceHash === source?.sourceHash
    && canonical(identity.images) === canonical(source?.images)
    && identity.schemaHash === source?.appliedMigrationHash
    && identity.policyHash === source?.policyMetadataHash
    && identity.infrastructureHash === source?.composeSourceHash;
  const expectedEvidenceHash = createHash('sha256').update(canonical({
    reportHash: createHash('sha256').update(reportBytes).digest('hex'),
    runtimeSourceBinding: source?.runtimeSourceBinding,
  })).digest('hex');
  if (!releaseMatches || identity.runtimeSourceBinding?.evidenceHash !== expectedEvidenceHash) {
    throw new Error('INTEGRATED_CANDIDATE_BINDING_MISMATCH');
  }
  const measurements = await collectIntegratedRegressionMeasurements({
    report, review, directory: path.dirname(path.resolve(reportPath)),
  });
  const signer = performanceMeasurementSignerFromEnvironment();
  if (!signer) throw new Error('MEASUREMENT_SIGNER_UNAVAILABLE');
  console.log(JSON.stringify(signedPerformanceAcceptanceLane({
    lane: 'integrated-regression', identity,
    command: 'node scripts/run-performance-integrated-acceptance.mjs --identity <candidate> --report <report> --review <review>',
    durationMs: performance.now() - started,
    rawEvidence: Buffer.concat([reportBytes, Buffer.from('\n'), reviewBytes]), measurements, signer,
  })));
} catch {
  console.error('Integrated acceptance failed closed; no lane evidence was issued.');
  process.exitCode = 1;
}
