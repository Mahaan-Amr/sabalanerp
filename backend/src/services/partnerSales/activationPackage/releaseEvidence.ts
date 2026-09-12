import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Prisma } from '@prisma/client';
import { acceptanceResponsibilities, readinessGates, type ReadinessEvidence } from '../operations/readiness';
import { verifyPartnerTrustedClaimsEnvelope } from './trustedClaimsEnvelope';
import { completeReleaseDeploymentGateReport } from '../../deploymentGates';

type PublicationRow = {
  id: string;
  deploymentId: string;
  releaseId: string;
  targetCommit: string;
  schemaId: string;
  checkedAt: Date;
  expiresAt: Date;
  packageSha256: string;
  trustEnvelopeSha256: string;
  trustKeyId: string;
  packageBytesBase64: string;
  trustEnvelopeBytesBase64: string;
  evidenceJson: Prisma.JsonValue;
  deployment: { id: string; releaseId: string; targetCommit: string; phase: string; reportJson: Prisma.JsonValue | null };
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/** Accepts only an immutable publication linked to a completed deployment. */
export function verifiedReadinessFromPublication(
  row: PublicationRow | null,
  expected: { deploymentId: string; releaseId: string; schemaId: string },
): ReadinessEvidence | null {
  if (!row || row.id !== expected.deploymentId || row.deploymentId !== expected.deploymentId
      || row.releaseId !== expected.releaseId || row.schemaId !== expected.schemaId) return null;
  const deployment = row.deployment, report = object(deployment.reportJson), evidence = object(row.evidenceJson);
  if (deployment.id !== row.deploymentId || deployment.phase !== 'COMPLETED'
      || deployment.releaseId !== row.releaseId || deployment.targetCommit !== row.targetCommit
      || !report || report.format !== 'sabalan-deployment-report' || report.version !== 1
      || report.deploymentId !== deployment.id || report.releaseId !== deployment.releaseId
      || report.targetCommit !== deployment.targetCommit || !completeReleaseDeploymentGateReport(report)
      || !evidence) return null;
  if (evidence.source !== 'DATABASE_VERIFIED' || evidence.evidenceId !== row.id
      || evidence.releaseId !== row.releaseId || evidence.schemaId !== expected.schemaId
      || evidence.checkedAt !== row.checkedAt.toISOString() || evidence.expiresAt !== row.expiresAt.toISOString()) return null;
  const gates = object(evidence.gates), acceptedBy = object(evidence.acceptedBy);
  if (!gates || !acceptedBy || readinessGates.some(gate => gates[gate] !== true)
      || acceptanceResponsibilities.some(role => typeof acceptedBy[role] !== 'string'
        || !String(acceptedBy[role]).trim())) return null;
  return evidence as unknown as ReadinessEvidence;
}

export function verifySignedPublication(input: { row: PublicationRow; publicKey: Buffer; now: string;
  evaluate(manifest: unknown, expected: Record<string, unknown>): { decision: string } }) {
  const { row } = input;
  try {
    const packageBytes = Buffer.from(row.packageBytesBase64, 'base64');
    const envelopeBytes = Buffer.from(row.trustEnvelopeBytesBase64, 'base64');
    if (packageBytes.toString('base64') !== row.packageBytesBase64
        || envelopeBytes.toString('base64') !== row.trustEnvelopeBytesBase64
        || createHash('sha256').update(packageBytes).digest('hex') !== row.packageSha256
        || createHash('sha256').update(envelopeBytes).digest('hex') !== row.trustEnvelopeSha256) return false;
    const { trusted, keyId } = verifyPartnerTrustedClaimsEnvelope({ bytes: envelopeBytes, publicKeySpkiDer: input.publicKey });
    if (keyId !== row.trustKeyId || trusted.packageSha256 !== row.packageSha256) return false;
    const manifest = JSON.parse(packageBytes.toString('utf8'));
    const result = input.evaluate(manifest, { now: input.now, expectedCommit: row.targetCommit,
      expectedTree: manifest?.candidate?.tree, expectedSchemaId: row.schemaId,
      releaseIdentity: trusted.releaseIdentity, trustedClaims: trusted.claims });
    if (result.decision !== 'GO' || manifest?.candidate?.releaseId !== row.releaseId) return false;
    const evidence = object(row.evidenceJson);
    return Boolean(evidence && evidence.checkedAt === manifest.evaluatedAt && evidence.expiresAt === manifest.expiresAt
      && acceptanceResponsibilities.every(role => object(manifest.approvals?.[role])?.actorId
        === object(evidence.acceptedBy)?.[role]));
  } catch { return false; }
}

export async function resolveDeploymentReadiness(
  tx: Prisma.TransactionClient,
  deploymentId: string,
  runtimeIdentity: { releaseId: string; schemaId: string },
) {
  const row = await tx.partnerReleaseReadinessPublication.findUnique({ where: { id: deploymentId }, include: {
    deployment: { select: { id: true, releaseId: true, targetCommit: true, phase: true, reportJson: true } },
  } });
  if (!row) return null;
  try {
    const publicKey = await fs.promises.readFile('/run/deployment-secrets/partner-release-trust-public.der');
    const verifierPath = path.resolve(process.cwd(), 'partner-release-verifier/release-package.mjs');
    const verifier = await import(pathToFileURL(verifierPath).href) as {
      evaluateReleasePackage(raw: unknown, expected: Record<string, unknown>): { decision: string };
    };
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!verifySignedPublication({ row, publicKey, now: clock.now.toISOString(),
      evaluate: verifier.evaluateReleasePackage })) return null;
  } catch { return null; }
  return verifiedReadinessFromPublication(row, { deploymentId, ...runtimeIdentity });
}
