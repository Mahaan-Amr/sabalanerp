import { PrismaClient } from '@prisma/client';
import { createDispatchDocumentRecoveryOperations, type DispatchRecoveryAuthority } from '../src/services/dispatchDocumentAuditRecovery';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]; const value = process.argv[index + 1];
  if (!key?.startsWith('--') || !value) throw new Error('Recovery arguments must be explicit --key value pairs.');
  args.set(key.slice(2), value);
}
const required = (key: string) => { const value = args.get(key)?.trim(); if (!value) throw new Error(`--${key} is required.`); return value; };
const command = required('command');
const actorId = required('actor-id');
const authority: DispatchRecoveryAuthority = {
  effectiveAuthority: 'SYSTEM_RECOVERY_ADMIN', workspace: 'SYSTEM_RECOVERY', feature: 'accounting_audit_view', permission: 'ADMIN',
  subjectType: 'DISPATCH_DOCUMENT', subjectId: required('subject-id'), sessionId: required('session-id'), deviceId: required('device-id'),
  beforeHash: required('before-hash'), afterHash: required('after-hash'),
};
const common = { actorId, authority, correlationId: required('correlation-id'), idempotencyKey: required('idempotency-key') };
const prisma = new PrismaClient();

try {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive || actor.role !== 'ADMIN') throw new Error('An active ADMIN operator is required for dispatch-document recovery mutation.');
  if (command === 'restore' && !process.env.DISPATCH_RECOVERY_PASSPHRASE) throw new Error('DISPATCH_RECOVERY_PASSPHRASE is required and must not be passed on the command line.');
  const operations = createDispatchDocumentRecoveryOperations(prisma);
  const result = command === 'replay' ? await operations.replay({ ...common, waybillId: required('waybill-id') })
    : command === 'reconcile' ? await operations.reconcile(common)
      : command === 'quarantine' ? await operations.quarantine({ ...common, storageKey: required('storage-key'), reason: required('reason'), reconciliationReportHash: required('report-hash'), observedAt: required('observed-at') })
        : command === 'cleanup' ? await operations.cleanup({ ...common, storageKey: required('storage-key'), reason: required('reason'), now: new Date() })
          : command === 'restore' ? await operations.restoreFromRecoveryPackage({ ...common, artifactId: required('artifact-id'), reason: required('reason'), recoveryPackagePath: required('package-path'), passphrase: process.env.DISPATCH_RECOVERY_PASSPHRASE || '' })
            : (() => { throw new Error('Unknown --command. Use replay, reconcile, restore, quarantine, or cleanup.'); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await prisma.$disconnect(); }
