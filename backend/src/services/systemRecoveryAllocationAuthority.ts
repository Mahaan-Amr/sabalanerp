import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { RoleSnapshot } from './protectedDatabaseRoleRecovery';

export type RecoveryRuntimeProof = { role: string; commit: string; releaseId: string; admitted: boolean; address?: string };
type AuthorityRows = { control: any[]; audit: any[]; activation: any[] };
export type RecoveryAllocationAuthority = {
  state: 'CLOSED' | 'ACTIVE'; sha256: string; commit: string; releaseId: string; admitted: boolean;
};
const rejected = () => new Error('SYSTEM_RECOVERY_ALLOCATION_AUTHORITY_REJECTED');
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const checksum = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export async function readRecoveryAllocationAuthority(prisma: Pick<PrismaClient, '$queryRaw'>): Promise<AuthorityRows> {
  const [rows] = await prisma.$queryRaw<AuthorityRows[]>`
    SELECT
      (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]') FROM public.customer_allocation_release_control c) AS control,
      (SELECT COALESCE(jsonb_agg(to_jsonb(a) || jsonb_build_object('id', a.id::text) ORDER BY a.id), '[]')
        FROM public.customer_allocation_release_audit a) AS audit,
      (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id), '[]') FROM public.deployment_operations d
        WHERE d.id IN (SELECT deployment_id FROM public.customer_allocation_release_control)) AS activation
  `;
  if (!rows) throw rejected();
  return rows;
}

export function captureRecoveryAllocationAuthority(rows: AuthorityRows, runtime: RecoveryRuntimeProof): RecoveryAllocationAuthority {
  const control = rows.control?.[0];
  if (rows.control?.length !== 1 || control.id !== 'grouped-allocation' || !['CLOSED', 'ACTIVE'].includes(control.state)
    || runtime.role !== 'sabalan_application_runtime' || !/^[a-f0-9]{40}$/.test(runtime.commit)
    || !runtime.releaseId || typeof runtime.admitted !== 'boolean' || runtime.admitted !== (control.state === 'ACTIVE')) throw rejected();
  if (control.state === 'ACTIVE') {
    const activation = rows.activation?.[0];
    if (rows.activation.length !== 1 || activation.id !== control.deployment_id
      || !['TRAFFIC_OPENED', 'COMPLETED'].includes(activation.phase) || activation.targetCommit !== runtime.commit
      || activation.releaseId !== runtime.releaseId || control.release_id !== runtime.releaseId
      || !/^[a-f0-9]{64}$/.test(control.manifest_sha256 || '')
      || rows.audit.filter(row => row.event === 'ACTIVATED' && row.deployment_id === control.deployment_id
        && row.release_id === control.release_id && row.manifest_sha256 === control.manifest_sha256
        && row.recorded_at === control.activated_at).length !== 1) throw rejected();
  }
  return { state: control.state, sha256: checksum(rows), commit: runtime.commit, releaseId: runtime.releaseId, admitted: runtime.admitted };
}

export function assertRecoveryAllocationContinuity(trusted: RecoveryAllocationAuthority, observed: AuthorityRows, runtime: RecoveryRuntimeProof) {
  const actual = captureRecoveryAllocationAuthority(observed, runtime);
  if (JSON.stringify(actual) !== JSON.stringify(trusted)) throw rejected();
}

export function recoveryOwnerReceiptPath(deploymentId: string, rollback = false) {
  if (!/^deploy-[A-Za-z0-9_-]{1,120}$/.test(deploymentId)) throw rejected();
  return path.join(process.env.DEPLOYMENT_REPORT_DIR || '/app/deployment-reports', `system-recovery-owner-${deploymentId}.${rollback ? 'rolledback' : 'completed'}.json`);
}

export type RecoveryOwnerPreparation = {
  format: 'sabalan-system-recovery-owner-preparation/v1'; deploymentId: string; operationId: string;
  leaseToken: string; checksum: string; checkpointChecksum: string; actorId: string; sourcePath: string;
  sourceDatabase: string; allocation: RecoveryAllocationAuthority; roles: RoleSnapshot;
};

export async function writeRecoveryOwnerFile(file: string, value: unknown) {
  const descriptor = await fs.open(file, 'wx', 0o400);
  try { await descriptor.writeFile(JSON.stringify(value) + '\n'); await descriptor.sync(); }
  finally { await descriptor.close(); }
  const directory = await fs.open(path.dirname(file), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export function recoveryOwnerPreparationPath(deploymentId: string) {
  return recoveryOwnerReceiptPath(deploymentId).replace(/\.completed\.json$/, '.prepared.json');
}

export async function readRecoveryOwnerPreparation(deploymentId: string): Promise<RecoveryOwnerPreparation> {
  const file = recoveryOwnerPreparationPath(deploymentId);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.uid !== 0 || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o400
    || stat.size > 16 * 1024 * 1024 || await fs.realpath(file) !== file) throw rejected();
  const preparation = JSON.parse(await fs.readFile(file, 'utf8')) as RecoveryOwnerPreparation;
  if (preparation.format !== 'sabalan-system-recovery-owner-preparation/v1' || preparation.deploymentId !== deploymentId
    || !/^c[a-z0-9]{24}$/.test(preparation.operationId) || !/^[a-f0-9]{64}$/.test(preparation.checksum)
    || !/^[a-f0-9]{64}$/.test(preparation.checkpointChecksum) || !preparation.leaseToken
    || preparation.roles?.sourceDatabase !== preparation.sourceDatabase || !preparation.allocation?.sha256) throw rejected();
  return preparation;
}

export async function readRecoveryOwnerReceipt(deploymentId: string, rollback = false) {
  const file = recoveryOwnerReceiptPath(deploymentId, rollback);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.uid !== 0 || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o400
    || stat.size > 32768 || await fs.realpath(file) !== file) throw rejected();
  const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
  if (receipt.format !== 'sabalan-system-recovery-owner-completion/v1' || receipt.deploymentId !== deploymentId
    || !/^c[a-z0-9]{24}$/.test(receipt.operationId) || receipt.ownerCompleted !== true
    || receipt.outcome !== (rollback ? 'ROLLED_BACK' : 'COMPLETED')
    || !/^[a-f0-9]{64}$/.test(receipt.allocation?.sha256 || '')) throw rejected();
  return receipt as { format: string; deploymentId: string; operationId: string; ownerCompleted: true; allocation: RecoveryAllocationAuthority };
}
