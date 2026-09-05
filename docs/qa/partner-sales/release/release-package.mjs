import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const READINESS_GATES = [
  'exactPairConstraints', 'immutableIdentity', 'stableRowIdentity', 'centralAuthorization',
  'profileActivation', 'inquiry', 'atomicCase', 'oneTimeCommitment', 'allowlistedCustomerOutput',
  'partnerOnlyAccounting', 'deliveryLineage', 'retailCollections', 'correctionAndVoiding',
  'reporting', 'internalSalesPreserved', 'integrationAccepted', 'combinedQaAccepted',
  'recoveryDrill', 'telemetryConnected', 'noOpenReleaseDefects',
];

export const ACCEPTANCE_RESPONSIBILITIES = [
  'RELEASE_OWNER', 'SALES', 'ACCOUNTING', 'TECH_SECURITY', 'HR', 'LOGISTICS',
];

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value
  : {};
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value));
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const imageDigest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

function attestationIsTrusted(raw, claim, candidate, expected) {
  const evidence = object(raw);
  const trustedDigest = object(expected.trustedClaims)[claim];
  return ['DATABASE_VERIFIED', 'CI_VERIFIED', 'HASH_VERIFIED_ARTIFACT', 'SIGNED_ATTESTATION', 'REMOTE_CHECKPOINT_VERIFIED']
    .includes(evidence.source)
    && typeof evidence.reference === 'string' && evidence.reference.trim()
    && sha256(evidence.digestSha256) && evidence.digestSha256 === trustedDigest
    && evidence.candidateCommit === candidate.commit
    && evidence.candidateTree === candidate.tree
    && evidence.schemaId === candidate.schemaId
    && instant(evidence.checkedAt) && instant(evidence.expiresAt)
    && evidence.checkedAt <= expected.now && expected.now < evidence.expiresAt;
}

export function evaluateReleasePackage(raw, expected) {
  const manifest = object(raw);
  const candidate = object(manifest.candidate);
  const gates = object(manifest.gates);
  const approvals = object(manifest.approvals);
  const activation = object(manifest.activation);
  const schemaVerification = object(manifest.schemaVerification);
  const attestations = object(manifest.attestations);
  const blockers = [];
  const trustedAttestation = (raw, claim) => attestationIsTrusted(
    typeof raw === 'string' ? attestations[raw] : raw,
    claim,
    candidate,
    expected,
  );

  if (manifest.format !== 'sabalan-partner-release-package' || manifest.version !== 1) {
    blockers.push('manifest:format:invalid');
  }
  if (!sha(candidate.commit) || candidate.commit !== expected.expectedCommit) {
    blockers.push('candidate:commit:mismatch');
  }
  if (!sha(candidate.tree) || candidate.tree !== expected.expectedTree) {
    blockers.push('candidate:tree:mismatch');
  }
  if (candidate.schemaId !== expected.expectedSchemaId) blockers.push('candidate:schema:mismatch');
  if (candidate.interfacePackage !== '@sabalanerp/partner-sales-contracts'
    || typeof candidate.interfaceVersion !== 'string'
    || candidate.wireSchemaVersion !== 1
    || !Number.isSafeInteger(candidate.migrationCount)
    || candidate.migrationCount < 1
    || typeof candidate.migrationSetSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(candidate.migrationSetSha256)) {
    blockers.push('candidate:identity:invalid');
  }
  const releaseSet = object(candidate.releaseSet);
  const releaseSetHasValidShape = typeof candidate.releaseId === 'string' && Boolean(candidate.releaseId.trim())
    && imageDigest(releaseSet.backend) && imageDigest(releaseSet.frontend)
    && imageDigest(releaseSet.inquiry) && imageDigest(releaseSet.nginx)
    && Array.isArray(releaseSet.supporting) && releaseSet.supporting.length > 0
    && releaseSet.supporting.every(imageDigest)
    && object(candidate.deploymentFormat).name === 'sabalan-deployment-report'
    && object(candidate.deploymentFormat).version === 1
    && object(candidate.checkpointFormat).name === 'sabalan-checkpoint-manifest'
    && object(candidate.checkpointFormat).version === 1;
  if (!releaseSetHasValidShape) {
    blockers.push('candidate:release-set:invalid');
  } else {
    const trustedRelease = object(expected.releaseIdentity);
    const trustedSet = object(trustedRelease.releaseSet);
    const releaseMatches = candidate.releaseId === trustedRelease.releaseId
      && releaseSet.backend === trustedSet.backend
      && releaseSet.frontend === trustedSet.frontend
      && releaseSet.inquiry === trustedSet.inquiry
      && releaseSet.nginx === trustedSet.nginx
      && JSON.stringify(releaseSet.supporting) === JSON.stringify(trustedSet.supporting)
      && JSON.stringify(candidate.deploymentFormat) === JSON.stringify(trustedRelease.deploymentFormat)
      && JSON.stringify(candidate.checkpointFormat) === JSON.stringify(trustedRelease.checkpointFormat);
    if (!releaseMatches) blockers.push('candidate:release-set:untrusted');
  }
  const schemaEvidenceMatches = schemaVerification.status === 'MATCH'
    && schemaVerification.repositoryMigrationCount === candidate.migrationCount
    && schemaVerification.runtimeAppliedMigrationCount === candidate.migrationCount
    && schemaVerification.repositoryMigrationSetSha256 === candidate.migrationSetSha256
    && schemaVerification.runtimeMigrationSetSha256 === candidate.migrationSetSha256
    && trustedAttestation(schemaVerification.evidence, 'schema:migration-set');
  if (!schemaEvidenceMatches) {
    blockers.push(`candidate:schema-evidence:${schemaVerification.status || 'MISSING'}`);
  }

  const checkpoint = object(manifest.remoteCheckpoint);
  if (checkpoint.status !== 'REMOTE_READBACK_VERIFIED') {
    blockers.push(`checkpoint:remote-readback:${checkpoint.status || 'MISSING'}`);
  } else if (checkpoint.releaseId !== candidate.releaseId
    || checkpoint.candidateCommit !== candidate.commit
    || checkpoint.candidateTree !== candidate.tree
    || checkpoint.schemaId !== candidate.schemaId
    || !sha256(checkpoint.archiveSha256)
    || !sha256(checkpoint.remoteFingerprintSha256)
    || checkpoint.remoteFingerprintSha256 !== checkpoint.archiveSha256
    || !sha256(checkpoint.sidecarSha256)
    || !instant(checkpoint.verifiedAt) || !instant(checkpoint.expiresAt)
    || checkpoint.verifiedAt > expected.now || expected.now >= checkpoint.expiresAt
    || typeof checkpoint.evidenceReference !== 'string' || !checkpoint.evidenceReference.trim()
    || !sha256(checkpoint.evidenceDigestSha256)
    || checkpoint.evidenceDigestSha256 !== object(expected.trustedClaims)['checkpoint:remote-readback']) {
    blockers.push('checkpoint:remote-readback:EVIDENCE_UNVERIFIED');
  }

  if (!instant(manifest.evaluatedAt) || !instant(manifest.expiresAt) || !instant(expected.now)) {
    blockers.push('evidence:time:invalid');
  } else {
    if (manifest.evaluatedAt > expected.now) blockers.push('evidence:not-yet-valid');
    if (expected.now >= manifest.expiresAt) blockers.push('evidence:expired');
  }

  for (const name of READINESS_GATES) {
    const gate = object(gates[name]);
    if (!Object.hasOwn(gates, name)) blockers.push(`gate:${name}:MISSING`);
    else if (gate.status !== 'PASS') blockers.push(`gate:${name}:${gate.status || 'INVALID'}`);
    else if (!Array.isArray(gate.evidence) || gate.evidence.length === 0
      || gate.evidence.some(evidence => !trustedAttestation(evidence, `gate:${name}`))) {
      blockers.push(`gate:${name}:EVIDENCE_UNVERIFIED`);
    }
  }

  for (const role of ACCEPTANCE_RESPONSIBILITIES) {
    const approval = object(approvals[role]);
    if (!Object.hasOwn(approvals, role)) blockers.push(`approval:${role}:MISSING`);
    else if (approval.status !== 'APPROVED') blockers.push(`approval:${role}:${approval.status || 'INVALID'}`);
    else if (typeof approval.actorId !== 'string' || !approval.actorId.trim()
      || typeof approval.authenticationRef !== 'string' || !approval.authenticationRef.trim()
      || approval.candidateCommit !== candidate.commit
      || approval.candidateTree !== candidate.tree
      || approval.schemaId !== candidate.schemaId
      || !instant(approval.issuedAt) || !instant(approval.expiresAt)
      || approval.issuedAt > expected.now || expected.now >= approval.expiresAt
      || typeof approval.evidenceReference !== 'string' || !approval.evidenceReference.trim()
      || !sha256(approval.evidenceDigestSha256)
      || approval.evidenceDigestSha256 !== object(expected.trustedClaims)[`approval:${role}`]) {
      blockers.push(`approval:${role}:EVIDENCE_UNVERIFIED`);
    }
  }

  if (activation.trafficOpened === true || activation.realSmsEnabled === true) {
    blockers.push('activation:already-mutated');
  }

  return { decision: blockers.length === 0 ? 'GO' : 'NO_GO', blockers };
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const manifestPath = process.argv[2];
  const trustedClaimsPath = argument('trusted-claims');
  const trusted = trustedClaimsPath
    ? JSON.parse(await fs.promises.readFile(trustedClaimsPath, 'utf8'))
    : {};
  const expected = {
    now: argument('now') || new Date().toISOString(),
    expectedCommit: argument('expected-commit'),
    expectedTree: argument('expected-tree'),
    expectedSchemaId: argument('expected-schema'),
    releaseIdentity: trusted.releaseIdentity,
    trustedClaims: trusted.claims,
  };
  if (!manifestPath || !expected.expectedCommit || !expected.expectedTree || !expected.expectedSchemaId) {
    throw new Error('Usage: node release-package.mjs <manifest.json> --expected-commit=<sha> --expected-tree=<sha> --expected-schema=<id> [--trusted-claims=<independent.json>] [--now=<ISO>]');
  }
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
  const result = evaluateReleasePackage(manifest, expected);
  console.log(JSON.stringify(result, null, 2));
  if (result.decision !== 'GO') process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(JSON.stringify({ decision: 'ERROR', message: error.message }));
    process.exitCode = 1;
  });
}
