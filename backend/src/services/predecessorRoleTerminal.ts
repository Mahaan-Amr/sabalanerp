import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import { completePredecessorRoleGateReport, predecessorRoleGatePhase } from './deploymentGates';
import { readCanonicalCheckpointMetadata } from './deploymentCheckpointMetadataIdentity';
import { deactivateDeploymentMaintenance, readDeploymentMaintenance } from './deploymentMaintenance';

const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const idPattern = /^[A-Za-z0-9_-]{1,160}$/;
type TerminalPhase = 'COMPLETED' | 'ROLLED_BACK';
type Session = {
  deploymentId: string; releaseId: string; targetCommit: string; owner: string; leaseToken: string;
  phase: string; purpose?: string; bootstrap: boolean; controlImage: string; rollbackReleaseSet: Record<string, string>;
};

function requireProof(condition: unknown): asserts condition {
  if (!condition) throw new Error('PREDECESSOR_ROLE_TERMINAL_UNPROVEN');
}

async function privateFile(file: string) {
  const before = await fs.lstat(file);
  requireProof(before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= 16 * 1024 * 1024
    && (process.platform !== 'linux' || (before.uid === process.getuid?.() && !(before.mode & 0o077))));
  const raw = await fs.readFile(file);
  const after = await fs.lstat(file);
  requireProof(raw.length === before.size && before.ino === after.ino && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs && before.dev === after.dev);
  return raw;
}

type Context = { prisma: PrismaClient; reportDir: string; coordinationDir: string; session: Session; token: string };

export async function predecessorRoleClockIdentity() {
  if (process.platform !== 'linux') return { bootId: os.hostname(), timeNamespace: process.platform };
  return {
    bootId: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
    timeNamespace: await fs.readlink('/proc/self/ns/time'),
  };
}

async function terminalDeadline(context: Context) {
  const { session, token, reportDir } = context;
  requireProof(idPattern.test(session.deploymentId) && token === session.leaseToken && hex.test(token)
    && (session.phase === 'MUTATION_STARTED' || session.phase === 'ROLLBACK_STARTED'));
  const kind = session.phase === 'ROLLBACK_STARTED' ? 'rollback' : 'mutation';
  const raw = await privateFile(path.join(reportDir, 'predecessor-role-' + session.deploymentId + '-' + kind + '-deadline.json'));
  const clock = JSON.parse(raw.toString('utf8'));
  requireProof(clock.format === 'sabalan-predecessor-role-deadline-v1' && clock.kind === kind
    && clock.deploymentId === session.deploymentId && clock.releaseId === session.releaseId && clock.targetCommit === session.targetCommit
    && clock.leaseTokenSha256 === sha(Buffer.from(token)) && clock.budgetSeconds === 900
    && /^[1-9][0-9]{0,19}$/.test(clock.startedNs) && /^[1-9][0-9]{0,19}$/.test(clock.deadlineNs)
    && isDeepStrictEqual(clock.clock, await predecessorRoleClockIdentity()));
  const now = process.hrtime.bigint(), start = BigInt(clock.startedNs), end = BigInt(clock.deadlineNs);
  requireProof(start <= now && now < end && end - start === 900_000_000_000n);
  return end;
}

async function activeOwner(context: Context, marker: boolean) {
  const { prisma, session, token, coordinationDir } = context;
  const deadline = await terminalDeadline(context);
  const phase = session.phase;
  requireProof(session.purpose === 'predecessor-role-cutover' && !session.bootstrap && session.leaseToken === token
    && hex.test(token) && idPattern.test(session.deploymentId) && idPattern.test(session.releaseId)
    && (phase === 'MUTATION_STARTED' || phase === 'ROLLBACK_STARTED'));
  const maintenance = await readDeploymentMaintenance(coordinationDir);
  requireProof(marker ? (maintenance?.deploymentId === session.deploymentId && maintenance?.releaseId === session.releaseId)
    : maintenance === null);
  const row = await prisma.deploymentOperation.findUnique({ where: { id: session.deploymentId } });
  requireProof(row && row.activeKey === 'production' && row.leaseToken === token && row.phase === phase
    && row.leaseExpiresAt.getTime() > Date.now() && row.releaseId === session.releaseId
    && row.targetCommit === session.targetCommit && row.owner === session.owner);
  const { metadata, sha256 } = readCanonicalCheckpointMetadata(
    JSON.parse(await privateFile(path.join(coordinationDir, 'deployment-checkpoint.json')).then(raw => raw.toString('utf8'))),
  );
  const point = row.checkpointJson as Record<string, any>;
  const report = row.reportJson as Record<string, any>;
  const applied = phase === 'MUTATION_STARTED';
  requireProof(metadata.deploymentId === session.deploymentId && metadata.releaseId === session.releaseId
    && metadata.targetCommit === session.targetCommit && metadata.localVerified === true && metadata.remoteVerified === true
    && metadata.localRestoreVerified === true && point?.checksum === metadata.checksum && hex.test(metadata.checksum)
    && isDeepStrictEqual(metadata.rollbackReleaseSet, session.rollbackReleaseSet)
    && isDeepStrictEqual(point.sourceDatabase, metadata.sourceDatabase)
    && report?.binding?.checkpointMetadataSha256 === sha256 && report.binding.checkpointSha256 === metadata.checksum
    && (applied ? report.state === 'staged' && hex.test(report.loginVerifierSha256)
      : report.state === 'restored' && report.loginVerifierSha256 === undefined));
  const [source] = await prisma.$queryRaw<Array<{name: string; oid: string; systemIdentifier: string}>>`
    SELECT current_database() AS name, (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
      (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`;
  requireProof(isDeepStrictEqual(source, metadata.sourceDatabase) && process.hrtime.bigint() < deadline);
  return { row, report, point, deadline, metadataSha256: sha256, state: applied ? 'APPLIED' : 'RESTORED',
    terminal: (applied ? 'COMPLETED' : 'ROLLED_BACK') as TerminalPhase };
}

export async function authorisePredecessorRoleTerminal(context: Context, input: Buffer) {
  const owner = await activeOwner(context, true);
  const { session, prisma, reportDir, token } = context;
  const gate = JSON.parse(input.toString('utf8'));
  const gateName = gate.gateReport;
  requireProof(gate.format === 'sabalan-predecessor-role-gate-acknowledgement-v1'
    && gate.deploymentId === session.deploymentId && gate.releaseId === session.releaseId && gate.targetCommit === session.targetCommit
    && gate.state === owner.state && gate.canOpenTraffic === false && predecessorRoleGatePhase(gate.gateMode) === session.phase
    && gate.checkpointSha256 === owner.point.checksum && gate.checkpointMetadataSha256 === owner.metadataSha256
    && isDeepStrictEqual(gate.rollbackReleaseSet, session.rollbackReleaseSet)
    && [gate.backendId, gate.nginxId, gate.gateReportSha256, gate.roleProofSha256, gate.nginxProofSha256,
      gate.nativeClosureSha256, gate.scannerBindingSha256].every(value => typeof value === 'string' && hex.test(value))
    && typeof gateName === 'string' && path.basename(gateName) === gateName && gateName.endsWith('.json')
    && gateName.startsWith(session.deploymentId + (owner.state === 'RESTORED' ? '.rollback.' : '.')));
  const raw = await privateFile(path.join(reportDir, gateName));
  const report = JSON.parse(raw.toString('utf8'));
  requireProof(sha(raw) === gate.gateReportSha256 && report.mode === gate.gateMode
    && report.deploymentId === session.deploymentId && report.targetCommit === session.targetCommit
    && completePredecessorRoleGateReport(report, { checksum: owner.point.checksum, releaseId: session.releaseId }));
  const ready = { gateAcknowledgementSha256: sha(input), checkpointSha256: owner.point.checksum,
    checkpointMetadataSha256: owner.metadataSha256, backendId: gate.backendId, nginxId: gate.nginxId,
    gateReport: gateName, gateReportSha256: gate.gateReportSha256, expectedTerminal: owner.terminal, state: owner.state };
  requireProof((!owner.report.terminalReady || isDeepStrictEqual(ready, owner.report.terminalReady))
    && process.hrtime.bigint() < owner.deadline);
  const updated = await prisma.deploymentOperation.updateMany({
    where: { id: session.deploymentId, activeKey: 'production', phase: session.phase, leaseToken: token,
      leaseExpiresAt: { gt: new Date() }, reportJson: { equals: owner.report } },
    data: { reportJson: { ...owner.report, terminalReady: ready } },
  });
  requireProof(updated.count === 1);
  return ready;
}

async function armedOpening(context: Context, marker: boolean) {
  const owner = await activeOwner(context, marker);
  const { session, reportDir } = context;
  const raw = await privateFile(path.join(reportDir, 'predecessor-role-cutover-open-intent.json'));
  const intent = JSON.parse(raw.toString('utf8'));
  const ready = owner.report.terminalReady;
  requireProof(ready && intent.format === 'sabalan-predecessor-role-public-intent/v1'
    && intent.trafficMayHaveOpened === true && intent.phase === session.phase && intent.state === owner.state
    && intent.deploymentId === session.deploymentId && intent.releaseId === session.releaseId
    && intent.targetCommit === session.targetCommit && isDeepStrictEqual(intent.rollbackReleaseSet, session.rollbackReleaseSet)
    && ['checkpointSha256', 'checkpointMetadataSha256', 'backendId', 'nginxId', 'expectedTerminal', 'gateAcknowledgementSha256']
      .every(key => intent[key] === ready[key])
    && [intent.hostHoldSha256, intent.reportHoldSha256, intent.scannerBindingSha256].every(value => typeof value === 'string' && hex.test(value))
    && Array.isArray(intent.origins) && intent.origins.length === 2 && new Set(intent.origins).size === 2
    && intent.origins.every((name: unknown) => typeof name === 'string' && /^[A-Za-z0-9.-]{1,253}$/.test(name)));
  const hold = await privateFile(path.join(reportDir, 'predecessor-role-cutover-active.json'));
  const proof = JSON.parse(hold.toString('utf8'));
  requireProof(sha(hold) === intent.reportHoldSha256 && proof.deploymentId === session.deploymentId
    && proof.releaseId === session.releaseId && proof.checkpointMetadataSha256 === owner.metadataSha256
    && path.basename(ready.gateReport) === ready.gateReport
    && sha(await privateFile(path.join(reportDir, ready.gateReport))) === ready.gateReportSha256);
  return { owner, intent, intentSha256: sha(raw) };
}

export async function openPredecessorRoleTerminal(context: Context) {
  const armed = await armedOpening(context, true);
  requireProof(process.hrtime.bigint() < armed.owner.deadline);
  await deactivateDeploymentMaintenance(context.coordinationDir, context.session.deploymentId);
  return { intentSha256: armed.intentSha256 };
}

export async function observePredecessorRoleTerminalOpening(context: Context) {
  const armed = await armedOpening(context, false);
  requireProof(process.hrtime.bigint() < armed.owner.deadline);
  return { intentSha256: armed.intentSha256 };
}

function expectedTerminal(session: Session) {
  return session.phase === 'MUTATION_STARTED' ? 'COMPLETED' : 'ROLLED_BACK';
}

export async function finishPredecessorRoleTerminal(context: Context, framed: Buffer) {
  const { session, token, prisma, coordinationDir } = context;
  const deadline = await terminalDeadline(context);
  const proof = JSON.parse(framed.toString('utf8'));
  const proofSha256 = sha(framed);
  requireProof(session.purpose === 'predecessor-role-cutover' && !session.bootstrap && token === session.leaseToken
    && (session.phase === 'MUTATION_STARTED' || session.phase === 'ROLLBACK_STARTED')
    && await readDeploymentMaintenance(coordinationDir) === null);
  const terminal = expectedTerminal(session);
  const prior = await prisma.deploymentOperation.findUnique({ where: { id: session.deploymentId } });
  if (prior?.activeKey === null && prior.phase === terminal) {
    const retained = (prior.reportJson as Record<string, any>)?.terminalClosed;
    requireProof(prior.releaseId === session.releaseId && prior.targetCommit === session.targetCommit
      && prior.owner === session.owner && prior.leaseToken === token && retained?.publicReadbackSha256 === proofSha256);
    return terminal;
  }
  const { owner, intent, intentSha256 } = await armedOpening(context, false);
  requireProof(process.hrtime.bigint() < deadline && isDeepStrictEqual(proof, {
    format: 'sabalan-predecessor-role-public-readback/v1', deploymentId: session.deploymentId,
    checkpointSha256: intent.checkpointSha256, backendId: intent.backendId, nginxId: intent.nginxId,
    gateAcknowledgementSha256: intent.gateAcknowledgementSha256,
    origins: Object.fromEntries(intent.origins.map((origin: string) => [origin, 200])),
    intentSha256, expectedTerminal: terminal,
  }));
  const now = new Date();
  const updated = await prisma.deploymentOperation.updateMany({
    where: { id: session.deploymentId, activeKey: 'production', leaseToken: token, leaseExpiresAt: { gt: now },
      phase: session.phase, reportJson: { equals: owner.report } },
    data: { phase: terminal, activeKey: null, completedAt: now,
      reportJson: { ...owner.report, terminalClosed: { publicReadbackSha256: proofSha256, intentSha256,
        gateAcknowledgementSha256: intent.gateAcknowledgementSha256, checkpointSha256: intent.checkpointSha256 } } },
  });
  requireProof(updated.count === 1);
  return terminal;
}

export async function readPredecessorRoleTerminal(prisma: PrismaClient, id: string, token: string) {
  requireProof(idPattern.test(id) && hex.test(token));
  const row = await prisma.deploymentOperation.findUnique({ where: { id } });
  const report = (row?.reportJson as Record<string, any>)?.terminalClosed;
  const activeLeases = await prisma.deploymentOperation.count({ where: { activeKey: 'production' } });
  requireProof(row?.activeKey === null && row.leaseToken === token && row.completedAt && activeLeases === 0
    && (row.phase === 'COMPLETED' || row.phase === 'ROLLED_BACK')
    && report && [report.publicReadbackSha256, report.intentSha256, report.gateAcknowledgementSha256, report.checkpointSha256]
      .every(value => typeof value === 'string' && hex.test(value)));
  return { deploymentId: id, releaseId: row.releaseId, targetCommit: row.targetCommit,
    checkpointSha256: report.checkpointSha256, gateAcknowledgementSha256: report.gateAcknowledgementSha256,
    phase: row.phase, activeLeases };
}
