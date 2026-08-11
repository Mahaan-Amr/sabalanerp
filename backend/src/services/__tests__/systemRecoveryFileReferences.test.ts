import assert from 'node:assert/strict';
import path from 'node:path';
import { recoveryEngineInternals } from '../systemRecoveryEngine';

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

console.log('system recovery file reference tests passed');
