import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendDeploymentHostJournal, validateDeploymentHostJournal } from '../deploymentHostJournal';

const run = async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sabalan-deploy-journal-'));
  const journal = path.join(root, 'journal.jsonl');
  try {
    await appendDeploymentHostJournal(journal, { deploymentId: 'd1', phase: 'PREFLIGHT', event: 'prepared' });
    await appendDeploymentHostJournal(journal, { deploymentId: 'd1', phase: 'LEASE_ACQUIRED', event: 'lease-acquired' });
    assert.equal((await validateDeploymentHostJournal(journal)).length, 2);
    await fs.promises.appendFile(journal, '{"sequence":3,"hash":"forged"}\n');
    await assert.rejects(() => validateDeploymentHostJournal(journal), (error: any) => error?.code === 'DEPLOYMENT_HOST_JOURNAL_INVALID');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  console.log('deployment host journal tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
