import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { completeReleaseDeploymentGateReport } from '../services/deploymentGates';
import { acceptanceResponsibilities, readinessGates } from '../services/partnerSales/operations/readiness';
import { verifyPartnerTrustedClaimsEnvelope } from '../services/partnerSales/activationPackage/trustedClaimsEnvelope';

const required = (name: string) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const argument = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length);
};
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, any> | null => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, any> : null;

async function main() {
  const deploymentId = argument('deployment-id'), packagePath = argument('package');
  const trustedClaimsPath = argument('trusted-claims'), expectedTree = argument('expected-tree');
  if (!deploymentId || !packagePath || !trustedClaimsPath || !expectedTree) {
    throw new Error('Usage: publish-partner-release-readiness --deployment-id=<id> --package=<json> --trusted-claims=<signed-json> --expected-tree=<sha>');
  }
  const schemaId = required('PARTNER_SCHEMA_ID');
  const verifierPath = path.resolve(process.cwd(), 'partner-release-verifier/release-package.mjs');
  const verifier = await import(pathToFileURL(verifierPath).href) as {
    evaluateReleasePackage(raw: unknown, expected: Record<string, unknown>): { decision: string; blockers: string[] };
  };
  const [packageBytes, trustEnvelopeBytes] = await Promise.all([
    fs.promises.readFile(path.resolve(packagePath)), fs.promises.readFile(path.resolve(trustedClaimsPath)),
  ]);
  const manifest = object(JSON.parse(packageBytes.toString('utf8')));
  const publicKey = await fs.promises.readFile('/run/deployment-secrets/partner-release-trust-public.der');
  const { trusted, keyId } = verifyPartnerTrustedClaimsEnvelope({ bytes: trustEnvelopeBytes, publicKeySpkiDer: publicKey });
  if (!manifest) throw new Error('Partner release package is invalid.');
  const packageSha256 = sha256(packageBytes);
  if (trusted.packageSha256 !== packageSha256) throw new Error('Signed trust payload does not bind this release package.');
  const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const deployment = await prisma.deploymentOperation.findUnique({ where: { id: deploymentId } });
  if (!deployment || deployment.phase !== 'COMPLETED' || !deployment.completedAt) {
    throw new Error('A completed deployment is required before Partner readiness can be published.');
  }
  const report = object(deployment.reportJson);
  if (!report || report.format !== 'sabalan-deployment-report' || report.version !== 1
      || report.deploymentId !== deployment.id || report.releaseId !== deployment.releaseId
      || report.targetCommit !== deployment.targetCommit || !completeReleaseDeploymentGateReport(report)) {
    throw new Error('Deployment report identity or mandatory gates are invalid.');
  }
  const result = verifier.evaluateReleasePackage(manifest, {
    now: clock.now.toISOString(), expectedCommit: deployment.targetCommit, expectedTree,
    expectedSchemaId: schemaId, releaseIdentity: trusted.releaseIdentity, trustedClaims: trusted.claims,
  });
  if (result.decision !== 'GO') throw new Error(`Partner release package is NO_GO: ${result.blockers.join(', ')}`);
  if (manifest.candidate?.releaseId !== deployment.releaseId) throw new Error('Release package does not belong to this deployment.');
  const evidence = {
    source: 'DATABASE_VERIFIED', evidenceId: deployment.id, releaseId: deployment.releaseId, schemaId,
    checkedAt: manifest.evaluatedAt, expiresAt: manifest.expiresAt,
    gates: Object.fromEntries(readinessGates.map(gate => [gate, true])),
    acceptedBy: Object.fromEntries(acceptanceResponsibilities.map(role => [role, manifest.approvals[role].actorId])),
  };
  await prisma.partnerReleaseReadinessPublication.create({ data: {
    id: deployment.id, deploymentId: deployment.id, releaseId: deployment.releaseId,
    targetCommit: deployment.targetCommit, schemaId, checkedAt: new Date(evidence.checkedAt),
    expiresAt: new Date(evidence.expiresAt), packageSha256: sha256(packageBytes),
    trustEnvelopeSha256: sha256(trustEnvelopeBytes), trustKeyId: keyId, evidenceJson: evidence,
    packageBytesBase64: packageBytes.toString('base64'), trustEnvelopeBytesBase64: trustEnvelopeBytes.toString('base64'),
  } });
  console.log(JSON.stringify({ ok: true, deploymentId, evidenceId: evidence.evidenceId, expiresAt: evidence.expiresAt }));
}

main().catch(error => { console.error(JSON.stringify({ ok: false, message: String(error?.message || error) })); process.exitCode = 1; })
  .finally(() => disconnectDatabase());
