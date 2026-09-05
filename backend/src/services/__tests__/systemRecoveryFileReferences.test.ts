import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoveryEngineInternals, validateLiveStoredFileReferences } from '../systemRecoveryEngine';

const applicationRoot = path.join(path.sep, 'srv', 'sabalanerp');
const recoveryRoot = path.join(applicationRoot, 'storage', 'recovery');

assert.deepEqual(
  recoveryEngineInternals.liveStoredFileReferenceCandidates(
    'recovery_operations',
    'manual-backup.sabrec',
    applicationRoot,
    recoveryRoot,
  ),
  [
    path.join(recoveryRoot, 'packages', 'manual-backup.sabrec'),
    path.join(recoveryRoot, 'uploads', 'manual-backup.sabrec'),
  ],
  'recovery operation files must be resolved in recovery storage, not general uploads',
);

const performanceMapping = recoveryEngineInternals.fileRecoveryMappings.find(
  (mapping) => mapping.safetyName === 'performance-exports',
);
assert.deepEqual(
  performanceMapping,
  {
    payloadPath: 'files/performance-exports',
    livePath: recoveryEngineInternals.performanceExportStorageDirectory,
    safetyName: 'performance-exports',
  },
  'performance exports must move through checkpoint, staged promotion, and rollback as one protected component',
);
assert.equal(
  recoveryEngineInternals.performanceExportBackupPath(
    path.join(path.sep, 'checkpoint'),
    path.join(path.sep, 'app', 'storage', 'performance-exports', 'nested', 'export.enc'),
    path.join(path.sep, 'app', 'storage', 'performance-exports'),
  ),
  path.join(path.sep, 'checkpoint', 'files', 'performance-exports', 'nested', 'export.enc'),
);
assert.throws(
  () => recoveryEngineInternals.performanceExportBackupPath(
    path.join(path.sep, 'checkpoint'),
    path.join(path.sep, 'app', 'storage', 'outside.enc'),
    path.join(path.sep, 'app', 'storage', 'performance-exports'),
  ),
  (error: any) => error?.code === 'UNSAFE_RECOVERY_PATH',
  'performance export references outside the protected root must fail closed',
);

assert.deepEqual(
  recoveryEngineInternals.liveStoredFileReferenceCandidates(
    'support_ticket_attachments',
    'evidence.pdf',
    applicationRoot,
    recoveryRoot,
  ),
  [path.join(applicationRoot, 'storage', 'support-tickets', 'evidence.pdf')],
);

const referencedStagedAttachments = new Set(['staged-referenced-evidence.jpg']);
assert.equal(
  recoveryEngineInternals.shouldExcludeSupportTicketCheckpointFile(
    'staged-referenced-evidence.jpg',
    referencedStagedAttachments,
  ),
  false,
  'a staged attachment referenced by the database must be included in the checkpoint',
);
assert.equal(
  recoveryEngineInternals.shouldExcludeSupportTicketCheckpointFile(
    'staged-abandoned-upload.jpg',
    referencedStagedAttachments,
  ),
  true,
  'an abandoned staged upload must remain excluded from the checkpoint',
);
assert.equal(
  recoveryEngineInternals.shouldExcludeSupportTicketCheckpointFile(
    'permanent-evidence.jpg',
    referencedStagedAttachments,
  ),
  false,
  'permanent support attachments must remain included in the checkpoint',
);

const main = async () => {
  let discoverySql = '';
  const fakeClient = {
    $queryRawUnsafe: async (sql: string) => {
      discoverySql = sql;
      return [];
    },
    performanceExportReceipt: { findMany: async () => [] },
  } as any;

  await validateLiveStoredFileReferences(fakeClient);
  assert.match(
    discoverySql,
    /table_name\s*<>\s*'recovery_operations'/,
    'expired recovery packages must not be treated as live business-file references',
  );

  const payloadRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'performance-recovery-reference-'));
  const artifactPath = path.join(recoveryEngineInternals.performanceExportStorageDirectory, 'ready-export.enc');
  const packagedArtifact = recoveryEngineInternals.performanceExportBackupPath(payloadRoot, artifactPath);
  await fs.promises.mkdir(path.dirname(packagedArtifact), { recursive: true });
  await fs.promises.writeFile(packagedArtifact, 'encrypted-export-bytes');
  const packageClient = {
    $queryRawUnsafe: async () => [],
    performanceExportReceipt: { findMany: async () => [{ id: 'ready-export', artifactPath }] },
    dispatchDocumentArtifact: { findMany: async () => [] },
  } as any;
  try {
    await recoveryEngineInternals.validateStoredFileReferences(packageClient, payloadRoot);
    await fs.promises.rm(packagedArtifact);
    await assert.rejects(
      () => recoveryEngineInternals.validateStoredFileReferences(packageClient, payloadRoot),
      (error: any) => error?.code === 'RECOVERY_PERFORMANCE_EXPORT_MISSING',
      'restore validation must reject a package whose database points at a missing performance export',
    );
  } finally {
    await fs.promises.rm(payloadRoot, { recursive: true, force: true });
  }

  console.log('system recovery file reference tests passed');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
