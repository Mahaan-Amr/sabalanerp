import assert from 'node:assert/strict';
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
  } as any;

  await validateLiveStoredFileReferences(fakeClient);
  assert.match(
    discoverySql,
    /table_name\s*<>\s*'recovery_operations'/,
    'expired recovery packages must not be treated as live business-file references',
  );

  console.log('system recovery file reference tests passed');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
