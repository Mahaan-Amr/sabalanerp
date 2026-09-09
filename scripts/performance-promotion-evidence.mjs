import { performanceSourceHash } from './performance-source-identity.mjs';
import { validatePromotionMeasurements } from './performance-promotion-measurements.mjs';
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const gateChecks = [
  ['SCHEMA_PROTECTION', ['additive-migration', 'permission-matrix', 'encryption', 'audit-lineage', 'retention', 'legal-hold', 'erasure', 'backup-restore']],
  ['POLICY_DARK_LAUNCH', ['policy-weights', 'policy-version-effective-time', 'policy-preview', 'policy-publication-authority', 'policy-snapshot']],
  ['READINESS', ['readiness-count-hash', 'structural-blockers', 'readiness-idempotency', 'readiness-drift', 'reconciliation']],
  ['SUPERVISOR_HR_PILOT', ['workflow-lifecycle', 'workflow-deadlines', 'notifications', 'self-review-audit', 'deterministic-races', 'safety-pause', 'runbook-rehearsal', 'observability']],
  ['RESULT_LEVEL_BADGE', ['calculation-reproduction', 'atomic-projection', 'expiry', 'correction', 'badge-disclosure']],
  ['ANALYTICS_RANKING_CALIBRATION', ['analytics-populations', 'differencing-reidentification', 'analytics-permissions']],
  ['PDF_EXCEL_EXPORT', ['export-async', 'export-capacity', 'export-scope', 'export-hash-ttl', 'export-revocation', 'export-cleanup', 'export-audit']],
  ['CONSEQUENCE_HANDOFF', ['handoff-permission', 'handoff-minimal-package', 'handoff-no-automatic-consequence', 'handoff-correction']],
  ['EXPANSION_RETIREMENT', ['capacity-profiles', 'cohort-promotion', 'compatibility-retirement', 'three-owner-approval', 'browser-acceptance', 'failure-injection']],
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validRelease = (release) => release && /^[a-f0-9]{40}$/.test(release.commit)
  && ['sourceHash', 'schemaHash', 'policyHash', 'infrastructureHash'].every((key) => digest(release[key]))
  && ['backend', 'frontend', 'inquiry'].every((key) => /^sha256:[a-f0-9]{64}$/.test(release.images?.[key]));
const phases = gateChecks.map(([name]) => name);
const stages = ['PILOT', 'TEN_PERCENT', 'TWENTY_FIVE_PERCENT', 'FIFTY_PERCENT', 'ALL'];
const validTarget = (target) => target && phases.includes(target.phase) && typeof target.cohortVersionId === 'string' && target.cohortVersionId.trim()
  && stages.includes(target.cohortStage) && digest(target.membershipHash)
  && Number.isSafeInteger(target.readyPopulation) && target.readyPopulation > 0
  && Number.isSafeInteger(target.memberCount) && target.memberCount > 0 && target.memberCount <= target.readyPopulation;
const attestationKey = () => {
  const keyId = process.env.PERFORMANCE_PROMOTION_ATTESTATION_KEY_ID?.trim() ?? '';
  const encoded = process.env.PERFORMANCE_PROMOTION_ATTESTATION_KEY_BASE64?.trim() ?? '';
  const key = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
  return keyId && !/^(change|replace|example|placeholder|local)/i.test(keyId)
    && key.length >= 32 && key.toString('base64') === encoded.replace(/\s/g, '') ? { keyId, key } : null;
};


try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') {
    throw new Error('Usage: node scripts/performance-promotion-evidence.mjs --input manifest.json --output report.json');
  }
  const inputPath = await realpath(args[1]);
  const directory = path.dirname(inputPath);
  const inputBytes = await readFile(inputPath);
  const input = JSON.parse(inputBytes);
  const blockers = [];
  if (input.schemaVersion !== 1) blockers.push('MANIFEST_VERSION_UNSUPPORTED');
  if (!validRelease(input.release)) blockers.push('RELEASE_IDENTITY_MISSING');
  else if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== input.release.commit) blockers.push('RELEASE_COMMIT_MISMATCH');
  if (validRelease(input.release) && await performanceSourceHash() !== input.release.sourceHash) blockers.push('RELEASE_SOURCE_MISMATCH');
  const checks = Array.isArray(input.checks) ? input.checks : [];
  const verified = new Map();
  for (const name of gateChecks.flatMap(([, names]) => names)) {
    const entries = checks.filter((check) => check?.name === name);
    if (entries.length !== 1) { verified.set(name, { status: 'BLOCKED', reason: 'MISSING_OR_DUPLICATE_CHECK' }); continue; }
    const entry = entries[0];
    try {
      const artifactPath = await realpath(path.resolve(directory, entry.path));
      if (!artifactPath.startsWith(`${directory}${path.sep}`)) throw new Error('UNSAFE_ARTIFACT_PATH');
      const bytes = await readFile(artifactPath);
      if (!digest(entry.sha256) || hash(bytes) !== entry.sha256) throw new Error('ARTIFACT_HASH_MISMATCH');
      const artifact = JSON.parse(bytes);
      if (artifact.schemaVersion !== 1 || artifact.check !== name || artifact.status !== 'PASS'
        || !Number.isFinite(artifact.durationMs) || artifact.durationMs < 0
        || !Number.isFinite(Date.parse(artifact.observedAt)) || Date.parse(artifact.observedAt) > Date.now()
        || typeof artifact.command !== 'string' || !artifact.command.trim()
        || canonical(artifact.release) !== canonical(input.release)) throw new Error('ARTIFACT_INVALID_OR_STALE');
      if (!validatePromotionMeasurements(name, artifact.measurements, artifact.observedAt)) throw new Error('RETIREMENT_EVIDENCE_INCOMPLETE');
      if (name === 'cohort-promotion' && validTarget(input.target)
        && (artifact.measurements.stage !== input.target.cohortStage
          || artifact.measurements.readyPopulation !== input.target.readyPopulation
          || artifact.measurements.members !== input.target.memberCount)) throw new Error('COHORT_TARGET_MISMATCH');
      verified.set(name, { status: 'PASS', sha256: entry.sha256, durationMs: artifact.durationMs });
    } catch {
      verified.set(name, { status: 'BLOCKED', reason: 'ARTIFACT_UNVERIFIED' });
    }
  }
  const targetIsValid = validTarget(input.target);
  const targetIndex = targetIsValid ? phases.indexOf(input.target.phase) : phases.length - 1;
  const gates = gateChecks.map(([name, names], index) => ({
    number: index + 1, name,
    status: targetIsValid && index > targetIndex ? 'NOT_REQUIRED'
      : blockers.length === 0 && names.every((check) => verified.get(check).status === 'PASS') ? 'PASS' : 'BLOCKED',
    checks: names.map((check) => ({ name: check, ...verified.get(check) })),
  }));
  if (!targetIsValid) blockers.push('PROMOTION_TARGET_MISSING');
  const verifiedAt = new Date().toISOString();
  const validUntil = Date.parse(input.validUntil);
  if (!Number.isFinite(validUntil) || validUntil <= Date.parse(verifiedAt)) blockers.push('PROMOTION_VALIDITY_WINDOW_INVALID');
  const signer = attestationKey();
  if (!signer) blockers.push('PROMOTION_ATTESTATION_CONFIGURATION_MISSING');
  const decision = targetIsValid && signer && blockers.length === 0
    && gates.every(({ status }, index) => index > targetIndex || status === 'PASS')
    ? 'EVIDENCE_COMPLETE' : 'BLOCKED';
  const unsignedReport = {
    schemaVersion: 1, decision, productionActivationAuthorized: false,
    manifestHash: hash(inputBytes), releaseIdentityHash: hash(canonical(input.release ?? null)), release: input.release ?? null,
    target: input.target ?? null, blockers, gates, verifiedAt, validUntil: input.validUntil ?? null,
  };
  const report = signer ? { ...unsignedReport, attestation: { keyId: signer.keyId, algorithm: 'HMAC-SHA256',
    signature: createHmac('sha256', signer.key).update(canonical(unsignedReport)).digest('hex') } } : unsignedReport;
  await writeFile(args[3], `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Performance promotion evidence: ${decision}. Report written.`);
  process.exitCode = decision === 'EVIDENCE_COMPLETE' ? 0 : 1;
} catch {
  console.error('Performance evidence verification failed. Check arguments, JSON, repository identity and output path; existing reports cannot be overwritten.');
  process.exitCode = 1;
}
